import { Injectable, signal, computed, inject } from '@angular/core';
import { User, StatCard, ProcessedTechnician, Job, RateCategory, Rate, PublishedPayroll, Adjustment, Loan, RecurringAdjustment, EmployeePayrollReport, ProcessedJob, PerformanceReport, PerformanceDataset, SubAdminPayrollBatch, ChargebackReport, SubAdminSettings, CareerApplication, JobOpening, QcFormTemplate, QcSubmission, QcImageUpload } from '../models/payroll.model';
import { environment } from '../environments/environment';
import { AppSettings } from './settings.service';
import { NotificationService } from './notification.service';
import { AuthService } from './auth.service';

// These are imported from the global scope from index.html
declare var firebase: any;

@Injectable({
  providedIn: 'root',
})
export class DatabaseService {
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService); // Injected to ensure AuthService constructor runs first.
  
  // Use a single signal to hold all state collections
  private state = signal<{ [key: string]: any[] }>({
    users: [], jobs: [], rateCategories: [], adjustments: [], publishedPayrolls: [],
    loans: [], recurringAdjustments: [], employeeReports: [], performanceReports: [],
    performanceDatasets: [], subAdminBatches: [], chargebackReports: [], settings: [],
    subAdminSettings: [], careerApplications: [], jobOpenings: [],
    qcFormTemplates: [], qcSubmissions: [],
  });
  
  private db: any;
  private storage: any; // For Firebase Storage
  private unsubscribeFunctions: (() => void)[] = [];
  private firstPublicSync = true;
  publicConnectionError = signal<string | null>(null);

  // Public signals for each collection
  users = computed<User[]>(() => this.state()['users'] || []);
  jobs = computed<Job[]>(() => this.state()['jobs'] || []);
  rateCategories = computed<RateCategory[]>(() => this.state()['rateCategories'] || []);
  adjustments = computed<Adjustment[]>(() => this.state()['adjustments'] || []);
  publishedPayrolls = computed<PublishedPayroll[]>(() => this.state()['publishedPayrolls'] || []);
  loans = computed<Loan[]>(() => this.state()['loans'] || []);
  recurringAdjustments = computed<RecurringAdjustment[]>(() => this.state()['recurringAdjustments'] || []);
  employeeReports = computed<EmployeePayrollReport[]>(() => this.state()['employeeReports'] || []);
  performanceReports = computed<PerformanceReport[]>(() => this.state()['performanceReports'] || []);
  performanceDatasets = computed<PerformanceDataset[]>(() => this.state()['performanceDatasets'] || []);
  subAdminBatches = computed<SubAdminPayrollBatch[]>(() => this.state()['subAdminBatches'] || []);
  chargebackReports = computed<ChargebackReport[]>(() => this.state()['chargebackReports'] || []);
  settings = computed<AppSettings[]>(() => this.state()['settings'] || []);
  subAdminSettings = computed<SubAdminSettings[]>(() => this.state()['subAdminSettings'] || []);
  careerApplications = computed<CareerApplication[]>(() => this.state()['careerApplications'] || []);
  jobOpenings = computed<JobOpening[]>(() => this.state()['jobOpenings'] || []);
  qcFormTemplates = computed<QcFormTemplate[]>(() => this.state()['qcFormTemplates'] || []);
  qcSubmissions = computed<QcSubmission[]>(() => this.state()['qcSubmissions'] || []);

  stats = computed(() => {
    // Explicitly read dependent signals to ensure this computed signal re-evaluates
    // when users, jobs, or rate categories change.
    this.users();
    this.jobs();
    this.rateCategories();
    return this._calculateStats();
  });
  
  processedTechnicians = computed(() => {
    // By reading these signals here, we establish a dependency.
    // Now, if if jobs, users, or rateCategories change, this computed signal will re-evaluate.
    const jobs = this.jobs();
    this.users();
    this.rateCategories();
    return this.processPayrollForJobs(jobs);
  });

  constructor() {
    // By injecting AuthService, its constructor is guaranteed to have run first,
    // which calls firebase.initializeApp(). It is now safe to get service instances.
    this.db = firebase.firestore();
    this.storage = firebase.storage();
    this.initializePublicListeners();
  }
  
  private listenToCollection(collectionName: string, query?: any): void {
    const collectionRef = query || this.db.collection(collectionName);
    const unsubscribe = collectionRef.onSnapshot((snapshot: any) => {
        const items = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
        this.state.update(currentState => {
            // For collections with specific queries (like user-specific data),
            // we need to merge the results carefully.
            const existingItems = currentState[collectionName] || [];
            const newItemsMap = new Map(items.map((item: any) => [item.id, item]));
            
            // Create a new array with updated/new items and existing items not in the new snapshot
            const finalItems = [
              ...existingItems.filter((item: any) => !newItemsMap.has(item.id)),
              ...items
            ];
            
            return {
                ...currentState,
                [collectionName]: finalItems
            };
        });
        console.log(`[DB] Synced ${collectionName}: ${items.length} items.`);
    }, (error: any) => {
        console.error(`[DB] Error syncing ${collectionName}:`, error);
    });
    this.unsubscribeFunctions.push(unsubscribe);
  }

  initializePublicListeners(): void {
    this.publicConnectionError.set(null);
    console.log('[DB] Initializing public listeners (settings, jobOpenings)...');
    
    ['settings', 'jobOpenings'].forEach(collectionName => {
        this.listenToCollection(collectionName);
    });

    // Seed data only once
    const unsubscribe = this.db.collection('settings').onSnapshot((snapshot: any) => {
      if (this.firstPublicSync) {
        this.firstPublicSync = false;
        this.seedInitialData(snapshot.docs.length > 0);
      }
    }, (error: any) => {
        console.error(`[DB] Error syncing settings for seeding check:`, error);
        const message = `Failed to connect to the database. Critical data could not be loaded. Please ensure Firestore security rules are correctly deployed.`;
        this.publicConnectionError.set(message);
        this.notificationService.show(message, 'error', 15000);
    });
    this.unsubscribeFunctions.push(unsubscribe);
  }

  async initialize(user: User): Promise<void> {
    console.log(`[DB] Initializing real-time listeners for user role: ${user.role}`);
    this.cleanup(true); // Clean up listeners, but keep public ones

    // Collections everyone needs
    this.listenToCollection('settings');
    this.listenToCollection('jobOpenings');
    this.listenToCollection('qcFormTemplates');
    // Listen to my own user document
    this.listenToCollection('users', this.db.collection('users').where('uid', '==', user.uid));


    switch (user.role) {
      case 'admin':
        this.initializeAdminListeners();
        break;
      case 'sub-admin':
      case 'supervisor':
        this.initializeManagerListeners(user);
        break;
      case 'employee':
        this.initializeEmployeeListeners(user);
        break;
    }
  }
  
  private initializeAdminListeners(): void {
    const adminCollections = [
      'users', 'jobs', 'rateCategories', 'adjustments', 'publishedPayrolls',
      'loans', 'recurringAdjustments', 'employeeReports', 'performanceReports',
      'performanceDatasets', 'subAdminBatches', 'chargebackReports', 'subAdminSettings',
      'careerApplications', 'qcSubmissions'
    ];
    adminCollections.forEach(name => this.listenToCollection(name));
  }

  private initializeManagerListeners(manager: User): void {
    const teamUserQuery = this.db.collection('users').where('assignedTo', '==', manager.id);
    this.listenToCollection('users', teamUserQuery);
    
    const teamIdsQuery = teamUserQuery.get().then((snapshot: any) => {
        const teamUserIds = snapshot.docs.map((doc: any) => doc.id);
        const allManagedIds = [manager.id, ...teamUserIds];

        if (allManagedIds.length > 0) {
            this.listenToCollection('employeeReports', this.db.collection('employeeReports').where('userId', 'in', allManagedIds));
            this.listenToCollection('performanceReports', this.db.collection('performanceReports').where('userId', 'in', allManagedIds));
        }
    });

    if (manager.role === 'sub-admin') {
      this.listenToCollection('subAdminBatches', this.db.collection('subAdminBatches').where('subAdminId', '==', manager.id));
      this.listenToCollection('subAdminSettings', this.db.collection('subAdminSettings').where('subAdminId', '==', manager.id));
    }
  }

  private initializeEmployeeListeners(employee: User): void {
      this.listenToCollection('employeeReports', this.db.collection('employeeReports').where('userId', '==', employee.id));
      this.listenToCollection('performanceReports', this.db.collection('performanceReports').where('userId', '==', employee.id));
      this.listenToCollection('chargebackReports', this.db.collection('chargebackReports').where('userId', '==', employee.id));
      this.listenToCollection('qcSubmissions', this.db.collection('qcSubmissions').where('userId', '==', employee.id));
  }

  cleanup(keepPublic: boolean = false): void {
    console.log('[DB] Cleaning up listeners...');
    this.unsubscribeFunctions.forEach(unsub => unsub());
    this.unsubscribeFunctions = [];
    
    // Reset state, but keep public data if requested (e.g., on login)
    const stateToKeep = keepPublic ? {
      settings: this.state().settings,
      jobOpenings: this.state().jobOpenings
    } : {};

    this.state.set({
      ...{
        users: [], jobs: [], rateCategories: [], adjustments: [], publishedPayrolls: [],
        loans: [], recurringAdjustments: [], employeeReports: [], performanceReports: [],
        performanceDatasets: [], subAdminBatches: [], chargebackReports: [], settings: [],
        subAdminSettings: [], careerApplications: [], qcFormTemplates: [], qcSubmissions: [],
      },
      ...stateToKeep
    });
    
    if (!keepPublic) {
      this.firstPublicSync = true;
      this.initializePublicListeners();
    }
  }
  
  // ============================================================
  // INITIAL DATA SEEDING
  // ============================================================
  private async seedInitialData(settingsExist: boolean): Promise<void> {
    await this.seedInitialSettings(settingsExist);
    await this.seedInitialAdmin();
    await this.seedBrightspeedRates();
  }

  private async seedBrightspeedRates(): Promise<void> {
    try {
        const brightspeedRef = this.db.collection('rateCategories').doc('brightspeed');
        // This is an idempotent operation. It creates if it doesn't exist, and overwrites with the same data if it does.
        // It's safe because these base rates are not meant to be modified by users.
        console.log('[DB] Seeding Brightspeed rate category...');
        const brightspeedRates: Rate[] = [
          { taskCode: 'Bonded Install', rate: 76.80 },
          { taskCode: 'Bonded Repair', rate: 41.60 },
          { taskCode: 'GPON Install', rate: 99.20 },
          { taskCode: 'GPON Repair', rate: 54.40 },
          { taskCode: 'HSI Full Install', rate: 76.80 },
          { taskCode: 'HSI Repair', rate: 41.60 },
          { taskCode: 'HSI Self Install', rate: 76.80 },
          { taskCode: 'POTS Install', rate: 48.00 },
          { taskCode: 'POTS Repair', rate: 41.60 },
          { taskCode: 'Brightspeed Fiber Install', rate: 76.80 },
          { taskCode: 'Brightspeed Fiber Repair', rate: 41.60 },
          { taskCode: 'Buried Site Check', rate: 55.04 },
          { taskCode: 'Ariel Fiber Drop <200\'', rate: 54.40 },
          { taskCode: 'Ariel Fiber Drop 201\'-400\'', rate: 67.20 },
          { taskCode: 'Ariel Fiber Drop 401\'-600\'', rate: 105.60 },
          { taskCode: 'Aerial Fiber Drop 601\'-1000\'', rate: 140.80 },
          { taskCode: 'Aerial Fiber Drop 1001\'-1500\'', rate: 192.00 },
          { taskCode: 'Aerial Fiber Drop 1501\'-2000\'', rate: 256.00 },
          { taskCode: 'Non-Complete', rate: 9.60 },
          { taskCode: 'Non-Complete (Referral)', rate: 23.40 },
        ];
        await brightspeedRef.set({ name: 'Brightspeed', rates: brightspeedRates });
        console.log('[DB] ✅ Successfully seeded Brightspeed rate category.');
    } catch (error) {
      console.error('[DB] ❌ Error seeding Brightspeed rates:', error);
    }
  }

  private async seedInitialAdmin(): Promise<void> {
    try {
        const adminRef = this.db.collection('users').doc('initial_admin');
        // This is an idempotent write. It is safe to run multiple times, but it will
        // overwrite any `uid` linked to this document. The AuthService handles this
        // by finding this doc and updating it. This is a known trade-off to ensure
        // the app can start up without requiring read permissions.
        console.log('[DB] Seeding initial admin user...');
        const adminUser: Omit<User, 'id' | 'password'> = {
            name: 'Administrator',
            username: 'admin',
            email: 'admin@primecommunication.com',
            techId: '000',
            phone: '000-000-0000',
            hireDate: new Date().toISOString().split('T')[0],
            role: 'admin',
        };
        await adminRef.set(adminUser);
        console.log('[DB] ✅ Successfully seeded initial admin user.');
    } catch (error) {
        console.error('[DB] ❌ Error seeding initial admin user:', error);
    }
  }

  private async seedInitialSettings(settingsExist: boolean): Promise<void> {
    if (!settingsExist) {
      console.log('[DB] No company settings found. Seeding initial settings...');
      const settingsRef = this.db.collection('settings').doc('company_settings');
      const PRIME_COMMUNICATION_LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNzUiIHZpZXdCb3g9IjAgMCAzMDAgNzUiPgo8c3R5bGU+CkBpbXBvcnQgdXJsKCdodHRwczovL2ZvbnRzLmdvb2dsZWFwaXMuY29tL2NzczI/ZmFtaWx5PU1hbnJvcGU6d2dodEA0MDAsNTAwLDYwMCw3MDAmZGlzcGxheT1zd2FwJyk7Cjwvc3R5bGU+CiAgPGc+CiAgICA8cGF0aCBmaWxsPSIjMjU2M0VCIiBkPSJNMTguMTUgMzAuMDYySDIuMjI3di01LjQ1NWwxMy4zMi0xMS45MDloMTAuMDkydjI4LjA2OEgzMC43NTVWMTguOTI1TDE4LjE1IDMwLjA2MnpNMi4yMjcgMzguOTc3aDE1LjkyVjU1SDIuMjI3di0xNi4wMjN6Ii8+CiAgICA8dGV4dCB4PSI0NiIgeT0iNDIuNSIgZm9udC1mYW1pbHk9Ik1hbnJvcGUsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNiIgbGV0dGVyLXNwYWNpbmc9Ii0uNSIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iIzFlMjkyYiI+UFJJTUU8L3RleHQ+CiAgICA8dGV4dCB4PSIxMzQiIHk9IjQyLjUiIGZvbnQtZmFtaWx5PSJNYW5yb3BlLHNhbnMtc2VyaWYiIGZvbnQtc2lplPSIyNiIgbGV0dGVyLXNwYWNpbmc9Ii0uNSIgZm9udC13ZWlnaHQ9IjUwMCIgZmlsbD0iIzFlMjkyYiI+Q09NTVVOSUNBVElPTjwvdGV4dD4KICAgIDx0ZXh0IHg9IjQ2IiB5PSI1Ni41IiBmb250LWZhbWlseT0iTWFucm9wZSxzYW5zLXNlcmlmIiBmb250LXNpemU9IjEwIiBsZXR0ZXItc3BhY2luZz0iMSIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iIzY0NzQ4YiI+V0lSRSBZT1VSIFdPUkxEITwvdGV4dD4KICA8L2c+Cjwvc3ZnPg==';
      const defaultSettings = {
        logoUrl: PRIME_COMMUNICATION_LOGO,
        companyName: 'Prime Communication LLC',
        companyAddress1: '83 Lincoln west dr',
        companyAddress2: 'Mountville pa 17554',
        companyEmail: 'info@primecom.com',
        companyPhone: '555-555-5555',
        partners: [
          { name: 'Optimum', logoUrl: 'https://logo.clearbit.com/optimum.com' },
          { name: 'Glo Fiber', logoUrl: 'https://logo.clearbit.com/glofiber.com' }
        ],
      };
      await settingsRef.set(defaultSettings);
      console.log('[DB] ✅ Successfully seeded initial company settings.');
    }
  }
  
  // ============================================================
  // SETTINGS OPERATIONS
  // ============================================================
  async updateSettings(settings: AppSettings): Promise<void> {
    const { id, ...settingsData } = settings as any;
    await this.db.collection('settings').doc('company_settings').update(settingsData);
  }

  async updateSubAdminSettings(settings: Omit<SubAdminSettings, 'id'>): Promise<void> {
    // Use subAdminId as the document ID for easy lookup.
    await this.db.collection('subAdminSettings').doc(settings.subAdminId).set(settings, { merge: true });
  }

  // ============================================================
  // USER OPERATIONS
  // ============================================================
  async getUnlinkedAdmin(): Promise<User | null> {
    try {
      const adminRef = this.db.collection('users').doc('initial_admin');
      const adminDoc = await adminRef.get();
      if (adminDoc.exists) {
        const data = adminDoc.data();
        if (!data.uid) {
          return { id: adminDoc.id, ...data } as User;
        }
      }
      return null;
    } catch (error) {
      console.error("[DB] Error fetching unlinked admin:", error);
      return null;
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const snapshot = await this.db.collection('users').where('email', '==', email).limit(1).get();
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  }
  
  async getUserByUid(uid: string): Promise<User | null> {
    const snapshot = await this.db.collection('users').where('uid', '==', uid).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as User;
  }
  
  async getUserByUsername(username: string): Promise<User | null> {
    const snapshot = await this.db.collection('users').where('username', '==', username).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as User;
  }

  async addUser(user: Omit<User, 'id'>): Promise<void> {
    // Note: Firebase Auth user creation should happen separately. This just adds to Firestore.
    // A robust ID generation is needed here, for now relying on Firestore auto-ID.
    // A better approach would be to manage a counter or use a more predictable ID.
    await this.db.collection('users').add(user);
  }

  async updateUser(user: User): Promise<void> {
    const { id, ...userData } = user;
    await this.db.collection('users').doc(String(id)).update(userData);
  }

  async deleteUser(userId: string): Promise<void> {
    // This only deletes from Firestore. The user must also be deleted from Firebase Auth console.
    await this.db.collection('users').doc(userId).delete();
  }

  // ============================================================
  // JOB OPERATIONS
  // ============================================================
  async addJobs(jobs: Omit<Job, 'id'>[]): Promise<void> {
    const batch = this.db.batch();
    jobs.forEach(job => {
      const docRef = this.db.collection('jobs').doc();
      batch.set(docRef, job);
    });
    await batch.commit();
  }
  
  async updateJob(job: Job): Promise<void> {
    const { id, ...jobData } = job;
    const payload: { [key: string]: any } = { ...jobData };
    if ('rateOverride' in payload && payload.rateOverride === undefined) {
      payload.rateOverride = firebase.firestore.FieldValue.delete();
    }
    await this.db.collection('jobs').doc(id).update(payload);
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.db.collection('jobs').doc(jobId).delete();
  }
  
  async clearJobs(): Promise<void> {
    const snapshot = await this.db.collection('jobs').get();
    const batch = this.db.batch();
    snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
  }
  
  // NEW: Bulk Job Operations
  async deleteJobs(jobIds: string[]): Promise<void> {
    const batch = this.db.batch();
    jobIds.forEach(id => {
      batch.delete(this.db.collection('jobs').doc(id));
    });
    await batch.commit();
  }

  async transferJobs(jobIds: string[], newTechId: string): Promise<void> {
    const batch = this.db.batch();
    jobIds.forEach(id => {
      batch.update(this.db.collection('jobs').doc(id), { techId: newTechId });
    });
    await batch.commit();
  }

  async bulkUpdateJobs(jobIds: string[], updates: Partial<Omit<Job, 'id'>>): Promise<void> {
    const batch = this.db.batch();
    const payload: { [key: string]: any } = { ...updates };
    if ('rateOverride' in payload && payload.rateOverride === undefined) {
      payload.rateOverride = firebase.firestore.FieldValue.delete();
    }
    jobIds.forEach(id => {
      batch.update(this.db.collection('jobs').doc(id), payload);
    });
    await batch.commit();
  }

  async bulkSetAerialDrop(jobIds: string[], status: boolean): Promise<void> {
    const batch = this.db.batch();
    const rateCategories = this.rateCategories();
    const users = this.users();

    const jobDocs = await Promise.all(jobIds.map(id => this.db.collection('jobs').doc(id).get()));

    for (const jobDoc of jobDocs) {
        if (!jobDoc.exists) continue;
        
        const job = { id: jobDoc.id, ...jobDoc.data() } as Job;
        const jobRef = jobDoc.ref;
        
        const isFiberJob = job.taskCode.toLowerCase().includes('fiber') || job.taskCode.toLowerCase().includes('ftth');
        if (!isFiberJob) {
            continue;
        }

        if (status === true) { // turning ON
            const user = users.find(u => u.techId === job.techId);
            if (!user || user.rateCategoryId === undefined) continue;

            const category = rateCategories.find(c => c.id === user.rateCategoryId);
            if (!category) continue;

            const jobRate = category.rates.find(r => r.taskCode === job.taskCode);
            const standardRate = jobRate ? jobRate.rate : null;
            
            const aerialDropRate = category.rates.find(r => r.taskCode === 'FTTH Aerial Drop Install');
            const payout = aerialDropRate ? aerialDropRate.rate : 0;

            if (standardRate !== null && payout > 0) {
                const newRate = standardRate + payout;
                batch.update(jobRef, { isAerialDrop: true, rateOverride: newRate });
            }
        } else { // turning OFF
            batch.update(jobRef, { isAerialDrop: false, rateOverride: firebase.firestore.FieldValue.delete() });
        }
    }
    await batch.commit();
}

  // ============================================================
  // RATE CATEGORY OPERATIONS
  // ============================================================
  async addRateCategory(name: string): Promise<void> {
    await this.db.collection('rateCategories').add({ name, rates: [] });
  }

  async updateRateCategory(categoryId: string, name: string): Promise<void> {
    await this.db.collection('rateCategories').doc(categoryId).update({ name });
  }

  async updateRatesForCategory(categoryId: string, rates: Rate[]): Promise<void> {
    await this.db.collection('rateCategories').doc(categoryId).update({ rates });
  }

  async deleteRateCategory(categoryId: string): Promise<void> {
    const usersToUpdate = this.users().filter(u => u.rateCategoryId === categoryId);
    if (usersToUpdate.length > 0) {
      const batch = this.db.batch();
      usersToUpdate.forEach(user => {
        const userRef = this.db.collection('users').doc(String(user.id));
        batch.update(userRef, { rateCategoryId: null });
      });
      await batch.commit();
    }
    await this.db.collection('rateCategories').doc(categoryId).delete();
  }
  
  // ============================================================
  // CAREER & JOB OPENING OPERATIONS
  // ============================================================
  async addCareerApplication(application: Omit<CareerApplication, 'id'>): Promise<void> {
    await this.db.collection('careerApplications').add(application);
  }

  async deleteCareerApplication(applicationId: string): Promise<void> {
    await this.db.collection('careerApplications').doc(applicationId).delete();
  }

  async addJobOpening(jobOpening: Omit<JobOpening, 'id'>): Promise<void> {
    await this.db.collection('jobOpenings').add(jobOpening);
  }

  async updateJobOpening(jobOpening: JobOpening): Promise<void> {
    const { id, ...jobData } = jobOpening;
    await this.db.collection('jobOpenings').doc(id).update(jobData);
  }

  async deleteJobOpening(jobOpeningId: string): Promise<void> {
    await this.db.collection('jobOpenings').doc(jobOpeningId).delete();
  }

  // ============================================================
  // QC OPERATIONS (REBUILT & SIMPLIFIED)
  // ============================================================
  async addQcFormTemplate(template: Omit<QcFormTemplate, 'id'>): Promise<void> {
    await this.db.collection('qcFormTemplates').add(template);
  }

  async updateQcFormTemplate(template: QcFormTemplate): Promise<void> {
    const { id, ...data } = template;
    await this.db.collection('qcFormTemplates').doc(id).update(data);
  }

  async deleteQcFormTemplate(templateId: string): Promise<void> {
    await this.db.collection('qcFormTemplates').doc(templateId).delete();
  }

  async addQcSubmission(submission: Omit<QcSubmission, 'id'>): Promise<void> {
    await this.db.collection('qcSubmissions').add(submission);
  }

  async deleteQcSubmission(submissionId: string): Promise<void> {
    await this.db.collection('qcSubmissions').doc(submissionId).delete();
  }
  
  async updateQcSubmission(submissionId: string, data: Partial<QcSubmission>): Promise<void> {
    await this.db.collection('qcSubmissions').doc(submissionId).update(data);
  }

  // ============================================================
  // OTHER OPERATIONS
  // ============================================================
  async transferJob(jobId: string, newTechId: string): Promise<void> {
    await this.db.collection('jobs').doc(jobId).update({ techId: newTechId });
  }

  async addOneTimeAdjustment(adjustment: Omit<Adjustment, 'id'>): Promise<void> {
    await this.db.collection('adjustments').add(adjustment);
  }
  
  async deleteAdjustment(adjustmentId: string): Promise<void> {
    await this.db.collection('adjustments').doc(adjustmentId).delete();
  }
  
  // ============================================================
  // COMPUTATION LOGIC (largely unchanged, but relies on signals)
  // ============================================================

  private getWeekOfYear(date: Date): number {
    if (!date || isNaN(date.getTime())) {
      console.error("getWeekOfYear called with an invalid date.");
      return 1; // Fallback week number
    }
    // This calculates the week number based on simple division of days from Jan 1st.
    // Week 1 is Jan 1-7, Week 2 is Jan 8-14, etc., regardless of day of week.
    // This provides a consistent, sequential number for the week within the year.
    const targetDate = this.parseDateAsUTC(date.toISOString().split('T')[0]);
    const startOfYear = new Date(Date.UTC(targetDate.getUTCFullYear(), 0, 1));
    const diff = targetDate.getTime() - startOfYear.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    // dayOfYear is 0 for Jan 1st
    const dayOfYear = Math.floor(diff / oneDay);
    return Math.ceil((dayOfYear + 1) / 7);
  }
  
   processPayrollForJobs(jobsToProcess: Job[], startDate?: Date, endDate?: Date): ProcessedTechnician[] {
    const allUsers: User[] = this.users();
    const userMap = new Map<string, User>(allUsers.map(u => [u.techId, u]));
    const userIdMap = new Map<string, User>(allUsers.map(u => [u.id, u]));
    const rateCategoryMap = new Map<string, RateCategory>(this.rateCategories().map(rc => [rc.id, rc]));
    
    const periodStartDate = startDate ? new Date(startDate) : null;
    const periodEndDate = endDate ? new Date(endDate) : null;
    if(periodEndDate) periodEndDate.setUTCHours(23, 59, 59, 999);

    const activeTechIds = new Set<string>(jobsToProcess.map(j => j.techId));
    
    const periodAdjustments: Adjustment[] = [];
    if (periodStartDate && periodEndDate) {
        this.adjustments().forEach(adj => {
            const adjDate = this.parseDateAsUTC(adj.date);
            if (adjDate >= periodStartDate && adjDate <= periodEndDate) {
                periodAdjustments.push(adj);
                activeTechIds.add(adj.techId);
            }
        });
        this.recurringAdjustments().filter(adj => adj.isActive).forEach(adj => {
            periodAdjustments.push({ id: adj.id, techId: adj.techId, date: periodEndDate.toISOString().split('T')[0], description: adj.description, amount: adj.weeklyAmount, type: 'Rent' });
            activeTechIds.add(adj.techId);
        });
    }

    const processedTechnicians: ProcessedTechnician[] = [];
    for (const techId of activeTechIds) {
        const user: User | undefined = userMap.get(techId);
        if (!user) continue;
        
        const techJobs = jobsToProcess.filter(j => j.techId === techId);
        const techAdjustments = periodAdjustments.filter(a => a.techId === techId);

        if (techJobs.length === 0 && techAdjustments.length === 0) continue;
        
        let finalRateCategoryId = user.rateCategoryId;
        if ((finalRateCategoryId === undefined || finalRateCategoryId === null) && user.assignedTo) {
            const subAdmin: User | undefined = userIdMap.get(user.assignedTo);
            if (subAdmin && subAdmin.rateCategoryId !== undefined) {
                finalRateCategoryId = subAdmin.rateCategoryId;
            }
        }
        
        const rateCategory: RateCategory | undefined = finalRateCategoryId ? rateCategoryMap.get(finalRateCategoryId) : undefined;
        const rates = new Map<string, number>(rateCategory?.rates?.map(r => [r.taskCode, r.rate]));

        // Get persistent payout overrides for the user
        const payoutOverrides = new Map(user.payoutOverrides?.map(o => [o.taskCode, o.rate]));

        const processedJobs: ProcessedJob[] = techJobs.map(job => {
            const rateFromCategory = rates.get(job.taskCode);
            const rateFromPersistentOverride = payoutOverrides.get(job.taskCode);

            // HIERARCHY: Job Override > Persistent Override > Category Rate. Default to 0.
            const rateApplied: number = job.rateOverride ?? rateFromPersistentOverride ?? rateFromCategory ?? 0;
            const earningInCents = Math.round(rateApplied * 100) * (job.quantity || 0);
            
            // Start with a base object of only required fields.
            const processedJob: ProcessedJob = {
                id: job.id,
                workOrder: job.workOrder,
                taskCode: job.taskCode,
                techId: job.techId,
                revenue: job.revenue || 0,
                quantity: job.quantity || 0,
                date: job.date,
                rateApplied,
                earning: earningInCents / 100,
            };

            // Conditionally add optional fields ONLY if they have a valid value.
            if (job.rateOverride !== undefined && job.rateOverride !== null) {
                processedJob.rateOverride = job.rateOverride;
            }
            if (job.isAerialDrop === true) {
                processedJob.isAerialDrop = true;
            }

            return processedJob;
        });

        const totalRevenueInCents = processedJobs.reduce((sum, job) => sum + Math.round((job.revenue || 0) * 100), 0);
        const baseEarningsInCents = processedJobs.reduce((sum, job) => sum + Math.round((job.earning || 0) * 100), 0);
        
        let companyRevenueInCents = totalRevenueInCents - baseEarningsInCents;
        
        if (user.role === 'sub-admin') {
            const teamMemberTechIds = new Set(allUsers.filter(u => u.assignedTo === user.id).map(u => u.techId));
            const teamJobs = jobsToProcess.filter(j => teamMemberTechIds.has(j.techId));
            const subAdminRateCategory: RateCategory | undefined = user.rateCategoryId ? rateCategoryMap.get(user.rateCategoryId) : undefined;
            if(subAdminRateCategory) {
                const subAdminRates = new Map<string, number>(subAdminRateCategory.rates.map(r => [r.taskCode, r.rate]));
                for (const teamJob of teamJobs) {
                    const employeeUser = userMap.get(teamJob.techId);
                    if(!employeeUser) continue;
                    
                    // Get persistent overrides for the team member
                    const employeePayoutOverrides = new Map(employeeUser.payoutOverrides?.map(o => [o.taskCode, o.rate]));
                    const rateFromPersistentOverride = employeePayoutOverrides.get(teamJob.taskCode);

                    let employeeRateCatId = employeeUser.rateCategoryId;
                    if ((employeeRateCatId === undefined || employeeRateCatId === null) && subAdminRateCategory.id) {
                      employeeRateCatId = subAdminRateCategory.id;
                    }


                    const employeeRateCategory: RateCategory | undefined = employeeRateCatId ? rateCategoryMap.get(employeeRateCatId) : undefined;
                    const employeeRates = new Map<string, number>(employeeRateCategory?.rates?.map(r => [r.taskCode, r.rate]));
                    const rateFromCategory = employeeRates.get(teamJob.taskCode) ?? 0;

                    const subAdminRate = subAdminRates.get(teamJob.taskCode) ?? 0;
                    
                    // HIERARCHY for team member payout
                    const actualPayoutRate = teamJob.rateOverride ?? rateFromPersistentOverride ?? rateFromCategory;
                    const finalPayoutRate = actualPayoutRate;

                    const profitInCents = (Math.round(subAdminRate * 100) - Math.round(finalPayoutRate * 100)) * (teamJob.quantity || 0);
                    const profitSharePercentage = user.profitShare ?? 50;
                    const subAdminProfitShareInCents = Math.round(profitInCents * (profitSharePercentage / 100));

                    if (subAdminProfitShareInCents !== 0) {
                        techAdjustments.push({
                            id: teamJob.id + '_profit', // Make ID unique string
                            techId: user.techId,
                            date: teamJob.date,
                            description: `Profit Share on #${teamJob.techId} - ${teamJob.taskCode}`,
                            amount: subAdminProfitShareInCents / 100,
                            type: 'Profit Share',
                        });
                    }
                }
            }
        }
        
        const adjustmentsTotalInCents = techAdjustments.reduce((sum, adj) => sum + Math.round((adj.amount || 0) * 100), 0);
        const totalEarningsInCents = baseEarningsInCents + adjustmentsTotalInCents;

        processedTechnicians.push({
            id: user.id, name: user.name, techId: user.techId,
            totalJobs: processedJobs.length,
            totalRevenue: totalRevenueInCents / 100, 
            totalEarnings: totalEarningsInCents / 100, 
            companyRevenue: companyRevenueInCents / 100,
            avgPerJob: processedJobs.length > 0 ? (baseEarningsInCents / processedJobs.length) / 100 : 0,
            processedJobs: processedJobs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
            adjustments: techAdjustments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
        });
    }

    return processedTechnicians.sort((a,b) => a.name.localeCompare(b.name));
  }

  public getStartOfWeek(date: Date): Date {
    // Check if the input date is valid
    if (!date || isNaN(date.getTime())) {
      return new Date(NaN); // Return an invalid date if input is invalid
    }
    const d = new Date(date.getTime()); // Create a copy to avoid mutating the original
    const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
    const diff = d.getUTCDate() - day; // Adjust to Sunday
    d.setUTCDate(diff);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  public parseDateAsUTC(dateString: string): Date {
    if (!dateString) {
      return new Date(NaN); // An invalid date
    }
    // handles YYYY-MM-DD and also YYYY-MM-DDTHH:mm:ss.sssZ
    const datePart = dateString.split('T')[0];
    const parts = datePart.split('-').map(Number);

    if (parts.length === 3 && !parts.some(isNaN)) {
      const [year, month, day] = parts;
      // Basic sanity check for month and day
      if (month < 1 || month > 12 || day < 1 || day > 31) {
          return new Date(NaN);
      }
      const d = new Date(Date.UTC(year, month - 1, day));
      // Final check to see if the date is valid (e.g. not 2024-02-30)
      if (d && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) {
          return d;
      }
    }
    return new Date(NaN);
  }

  private _calculateStats(): StatCard[] {
    const users = this.users();
    const jobs = this.jobs();
    const technicians = users.filter(u => u.role === 'employee' || u.role === 'sub-admin' || u.role === 'supervisor');
    
    const processedReport = this.processPayrollForJobs(jobs);

    const currentPeriodRevenueInCents = processedReport.reduce((sum, tech) => sum + Math.round(tech.totalRevenue * 100), 0);
    const totalPayoutInCents = processedReport.reduce((sum, tech) => sum + Math.round(tech.totalEarnings * 100), 0);
    const currentCompanyRevenueInCents = currentPeriodRevenueInCents - totalPayoutInCents;
    const currentPeriodJobs = processedReport.reduce((sum, tech) => sum + tech.totalJobs, 0);

    return [
      { label: 'Total Employees', value: technicians.length.toString(), icon: 'users', color: 'blue', description: 'Active technicians in system' },
      { label: 'Current Period Revenue', value: (currentPeriodRevenueInCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }), icon: 'revenue', color: 'green', description: 'From unprocessed jobs' },
      { label: 'Company Revenue', value: (currentCompanyRevenueInCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }), icon: 'company', color: 'purple', description: 'Estimated from current jobs' },
      { label: 'Current Period Jobs', value: currentPeriodJobs.toString(), icon: 'jobs', color: 'orange', description: 'Total unprocessed job entries' },
    ];
  }
  
  async addPlaceholderUsers(newTechs: { techId: string; name: string }[]): Promise<void> {
    const batch = this.db.batch();
    const allRateCategories = this.rateCategories();
    const standardCategory = allRateCategories.find(c => c.name.toLowerCase() === 'standard');
    const defaultRateCategoryId = standardCategory ? standardCategory.id : null;

    newTechs.forEach(tech => {
      const newUser: Omit<User, 'id' | 'password' | 'rateCategoryId'> & { rateCategoryId?: string } = {
        name: tech.name,
        username: tech.techId, // default username to techId
        techId: tech.techId,
        email: `tech${tech.techId}@primecommunication.com`, // placeholder email
        phone: '000-000-0000',
        hireDate: new Date().toISOString().split('T')[0],
        role: 'employee',
      };
      if (defaultRateCategoryId) {
        newUser.rateCategoryId = defaultRateCategoryId;
      }
      const docRef = this.db.collection('users').doc(); // Firestore auto-generates ID
      batch.set(docRef, newUser);
    });
    await batch.commit();
  }
  
  // ============================================================
  // FULLY IMPLEMENTED ASYNC METHODS
  // ============================================================

  async publishPayroll(report: ProcessedTechnician[], jobs: Job[], startDate: string, endDate: string): Promise<string> {
    const batch = this.db.batch();
    const payrollId = `${startDate}_${endDate}`;
    const payrollRef = this.db.collection('publishedPayrolls').doc(payrollId);

    // Calculate the payment ID based on the week number of the year of the end date.
    const endDateObj = this.parseDateAsUTC(endDate);
    if (isNaN(endDateObj.getTime())) {
      throw new Error(`Invalid end date "${endDate}" provided for payroll publication.`);
    }
    const paymentId = this.getWeekOfYear(endDateObj);

    const newPayroll: PublishedPayroll = {
        id: payrollId,
        startDate,
        endDate,
        publishedDate: new Date().toISOString(),
        reportData: report,
        status: 'finalized',
    };
    batch.set(payrollRef, newPayroll);

    // Create individual employee reports and update loans
    report.forEach((techReport: ProcessedTechnician) => {
        const employeeReportId = `${payrollId}_${techReport.id}`;
        const employeeReportRef = this.db.collection('employeeReports').doc(employeeReportId);
        const employeeReport: EmployeePayrollReport = {
            id: employeeReportId,
            userId: techReport.id,
            payrollId,
            paymentId: paymentId,
            startDate,
            endDate,
            publishedDate: new Date().toISOString(),
            reportData: techReport,
            status: 'finalized',
        };
        batch.set(employeeReportRef, employeeReport);

        // Handle loan deductions
        techReport.adjustments.filter(a => a.type === 'Loan Payment' && a.loanId).forEach(adj => {
            const loan = this.loans().find(l => l.id === adj.loanId);
            if (loan) {
                const loanRef = this.db.collection('loans').doc(loan.id);
                const newRemaining = loan.remainingAmount + adj.amount; // adj.amount is negative
                const updatePayload: { remainingAmount: any; isActive?: boolean } = {
                    remainingAmount: firebase.firestore.FieldValue.increment(adj.amount)
                };
                if (newRemaining <= 0) {
                    updatePayload.isActive = false;
                }
                batch.update(loanRef, updatePayload);
            }
        });
    });

    // Create Sub-Admin batches
    const subAdmins = this.users().filter(u => u.role === 'sub-admin');
    const userMap = new Map(this.users().map(u => [u.id, u]));

    subAdmins.forEach(sa => {
        const teamMemberIds = this.users().filter(u => u.assignedTo === sa.id).map(u => u.id);
        const allMemberIds = [sa.id, ...teamMemberIds];
        const batchJobs = jobs.filter(j => {
            const jobUser = this.users().find(u => u.techId === j.techId);
            return jobUser && allMemberIds.includes(jobUser.id);
        });

        if (batchJobs.length > 0) {
            const batchId = `${sa.id}_${startDate}_${endDate}`;
            const subAdminBatchRef = this.db.collection('subAdminBatches').doc(batchId);
            const newBatch: SubAdminPayrollBatch = {
                id: batchId,
                subAdminId: sa.id,
                startDate,
                endDate,
                jobs: batchJobs,
                status: 'pending',
            };
            batch.set(subAdminBatchRef, newBatch);
        }
    });

    // Delete processed jobs and one-time adjustments
    const processedJobIds = new Set(jobs.map(j => j.id));
    const processedAdjIds = new Set(report.flatMap(r => r.adjustments.filter(a => a.type !== 'Rent')).map(a => a.id));

    this.jobs().filter(j => processedJobIds.has(j.id)).forEach(job => {
        batch.delete(this.db.collection('jobs').doc(String(job.id)));
    });

    this.adjustments().filter(a => processedAdjIds.has(a.id)).forEach(adj => {
        batch.delete(this.db.collection('adjustments').doc(String(adj.id)));
    });

    await batch.commit();
    return payrollId;
  }

  async deletePayroll(payrollId: string): Promise<void> {
    const batch = this.db.batch();
    const [startDate, endDate] = payrollId.split('_');
    if (!startDate || !endDate) {
        throw new Error(`Invalid payrollId format for unpublishing: ${payrollId}`);
    }

    // 1. Delete all employee reports associated with this payrollId
    const employeeReportsSnapshot = await this.db.collection('employeeReports').where('payrollId', '==', payrollId).get();
    if (!employeeReportsSnapshot.empty) {
        employeeReportsSnapshot.forEach((doc: any) => batch.delete(doc.ref));
    }
    
    // 2. Delete all sub-admin batches (pending or finalized) for this period
    const subAdminBatchesSnapshot = await this.db.collection('subAdminBatches')
        .where('startDate', '==', startDate)
        .where('endDate', '==', endDate)
        .get();

    if (!subAdminBatchesSnapshot.empty) {
        subAdminBatchesSnapshot.forEach((doc: any) => batch.delete(doc.ref));
    }
    
    await batch.commit();
  }

  async assignEmployeeToSubAdmin(employeeId: string, subAdminId: string): Promise<void> {
    await this.db.collection('users').doc(employeeId).update({ assignedTo: subAdminId });
  }

  async unassignEmployee(employeeId: string): Promise<void> {
    await this.db.collection('users').doc(employeeId).update({ assignedTo: firebase.firestore.FieldValue.delete() });
  }

  async updateSubAdminBatchJob(batchId: string, updatedJob: Job): Promise<void> {
    const batchRef = this.db.collection('subAdminBatches').doc(batchId);
    await this.db.runTransaction(async (transaction: any) => {
        const doc = await transaction.get(batchRef);
        if (!doc.exists) throw new Error("Batch not found.");
        const jobs = doc.data().jobs;
        const index = jobs.findIndex((j: Job) => j.id === updatedJob.id);
        if (index > -1) {
            jobs[index] = updatedJob;
            transaction.update(batchRef, { jobs });
        }
    });
  }

  async updateSubAdminBatchJobs(batchId: string, updatedJobs: Job[]): Promise<void> {
      const batchRef = this.db.collection('subAdminBatches').doc(batchId);
      const updatedJobMap = new Map(updatedJobs.map(j => [j.id, j]));
      await this.db.runTransaction(async (transaction: any) => {
        const doc = await transaction.get(batchRef);
        if (!doc.exists) throw new Error("Batch not found.");
        const jobs = doc.data().jobs.map((j: Job) => updatedJobMap.has(j.id) ? updatedJobMap.get(j.id) : j);
        transaction.update(batchRef, { jobs });
    });
  }

  async deleteSubAdminBatchJob(batchId: string, jobId: string): Promise<void> {
    const batchRef = this.db.collection('subAdminBatches').doc(batchId);
    await this.db.runTransaction(async (transaction: any) => {
        const doc = await transaction.get(batchRef);
        if (!doc.exists) throw new Error("Batch not found.");
        const jobs = doc.data().jobs.filter((j: Job) => j.id !== jobId);
        transaction.update(batchRef, { jobs });
    });
  }

  async transferSubAdminBatchJob(batchId: string, jobId: string, newTechId: string): Promise<void> {
    const batchRef = this.db.collection('subAdminBatches').doc(batchId);
     await this.db.runTransaction(async (transaction: any) => {
        const doc = await transaction.get(batchRef);
        if (!doc.exists) throw new Error("Batch not found.");
        const jobs = doc.data().jobs;
        const job = jobs.find((j: Job) => j.id === jobId);
        if (job) {
            job.techId = newTechId;
            transaction.update(batchRef, { jobs });
        }
    });
  }

  async finalizeSubAdminBatch(batchId: string): Promise<void> {
    const batchRef = this.db.collection('subAdminBatches').doc(batchId);
    const batchDoc = await batchRef.get();
    if (!batchDoc.exists) throw new Error("Batch not found.");
    const batchData = batchDoc.data() as SubAdminPayrollBatch;

    const report = this.processPayrollForJobs(batchData.jobs, this.parseDateAsUTC(batchData.startDate), this.parseDateAsUTC(batchData.endDate));
    
    const writeBatch = this.db.batch();
    
    const endDateObj = this.parseDateAsUTC(batchData.endDate);
    const paymentId = this.getWeekOfYear(endDateObj);

    // Finalize batch status
    writeBatch.update(batchRef, { status: 'finalized' });

    // Create employee reports for team
    report.forEach((techReport) => {
        const payrollId = `sub_${batchId}`;
        const employeeReportId = `${payrollId}_${techReport.id}`;
        const employeeReportRef = this.db.collection('employeeReports').doc(employeeReportId);
        const employeeReport: EmployeePayrollReport = {
            id: employeeReportId,
            userId: techReport.id,
            payrollId,
            paymentId: paymentId,
            startDate: batchData.startDate,
            endDate: batchData.endDate,
            publishedDate: new Date().toISOString(),
            reportData: techReport,
            status: 'finalized',
        };
        writeBatch.set(employeeReportRef, employeeReport);
    });

    await writeBatch.commit();
  }

  async addOrUpdatePerformanceReport(reportData: Omit<PerformanceReport, 'id' | 'status'>): Promise<void> {
    const reportId = `${reportData.weekStartDate}_${reportData.userId}`;
    await this.db.collection('performanceReports').doc(reportId).set({ ...reportData, status: 'draft' }, { merge: true });
  }
  
  async updatePerformanceReport(reportId: string, data: Partial<PerformanceReport>): Promise<void> {
    await this.db.collection('performanceReports').doc(reportId).update(data);
  }

  async publishPerformanceReportsForWeek(weekStartDate: string): Promise<void> {
    const snapshot = await this.db.collection('performanceReports').where('weekStartDate', '==', weekStartDate).where('status', '==', 'draft').get();
    const batch = this.db.batch();
    snapshot.docs.forEach((doc: any) => {
        batch.update(doc.ref, { status: 'published' });
    });
    await batch.commit();
  }

  async deletePerformanceReport(reportId: string): Promise<void> {
    await this.db.collection('performanceReports').doc(reportId).delete();
  }

  async addOrUpdateChargebackReport(reportData: Omit<ChargebackReport, 'id' | 'status' | 'uploadDate'>): Promise<void> {
    const reportId = `${reportData.monthIdentifier}_${reportData.userId}`;
    const dataToSave = {
        ...reportData,
        status: 'draft',
        uploadDate: new Date().toISOString(),
    };
    await this.db.collection('chargebackReports').doc(reportId).set(dataToSave, { merge: true });
  }
  
  async updateChargebackReport(reportId: string, data: Partial<ChargebackReport>): Promise<void> {
    await this.db.collection('chargebackReports').doc(reportId).update(data);
  }

  async publishChargebackReportsForMonth(monthIdentifier: string): Promise<void> {
    const snapshot = await this.db.collection('chargebackReports').where('monthIdentifier', '==', monthIdentifier).where('status', '==', 'draft').get();
    const batch = this.db.batch();
    snapshot.docs.forEach((doc: any) => {
        batch.update(doc.ref, { status: 'published' });
    });
    await batch.commit();
  }

  async deleteChargebackReport(reportId: string): Promise<void> {
    await this.db.collection('chargebackReports').doc(reportId).delete();
  }

  async updateLoan(loan: Loan): Promise<void> {
    const { id, ...loanData } = loan;
    await this.db.collection('loans').doc(String(id)).update(loanData);
  }

  async addLoan(loan: Omit<Loan, 'id'>): Promise<void> {
    await this.db.collection('loans').add(loan);
  }

  async addRecurringAdjustment(adj: Omit<RecurringAdjustment, 'id'>): Promise<void> {
    await this.db.collection('recurringAdjustments').add(adj);
  }

  async updateRecurringAdjustment(adj: RecurringAdjustment): Promise<void> {
    const { id, ...adjData } = adj;
    await this.db.collection('recurringAdjustments').doc(String(id)).update(adjData);
  }
  
  async addPerformanceDataset(fileName: string, dataUrl: string, uploadDate?: string): Promise<void> {
    const newDataset: Omit<PerformanceDataset, 'id'> = {
      fileName,
      uploadDate: uploadDate ? new Date(uploadDate).toISOString() : new Date().toISOString(),
      dataUrl
    };
    await this.db.collection('performanceDatasets').add(newDataset);
  }

  async deletePerformanceDataset(datasetId: string): Promise<void> {
    await this.db.collection('performanceDatasets').doc(datasetId).delete();
  }
}