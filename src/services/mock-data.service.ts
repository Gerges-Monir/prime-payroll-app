import { Injectable, signal, computed, effect } from '@angular/core';
import { User, StatCard, ProcessedTechnician, Job, RateCategory, Rate, PublishedPayroll, Adjustment, Loan, RecurringAdjustment, EmployeePayrollReport, AdjustmentType } from '../models/payroll.model';

@Injectable({
  providedIn: 'root',
})
export class MockDataService {
  private storageKeys = {
    users: 'primePayroll_users',
    jobs: 'primePayroll_jobs',
    rateCategories: 'primePayroll_rateCategories',
    adjustments: 'primePayroll_adjustments',
    publishedPayrolls: 'primePayroll_publishedPayrolls',
    loans: 'primePayroll_loans',
    recurringAdjustments: 'primePayroll_recurringAdjustments',
    employeeReports: 'primePayroll_employeeReports',
  };

  // Signals for application state
  users = signal<User[]>([]);
  jobs = signal<Job[]>([]);
  rateCategories = signal<RateCategory[]>([]);
  adjustments = signal<Adjustment[]>([]); // Changed from Map to Array
  publishedPayrolls = signal<PublishedPayroll[]>([]);
  loans = signal<Loan[]>([]);
  recurringAdjustments = signal<RecurringAdjustment[]>([]);
  employeeReports = signal<EmployeePayrollReport[]>([]);

  // Default initial data for first-time setup - ONLY the admin user.
  private initialUsers: User[] = [
    { id: 1, name: 'Admin User', username: 'admin', password: 'admin', techId: '001', email: 'admin@prime.com', phone: '555-0100', hireDate: '2020-01-01', role: 'admin' },
  ];
  
  private initialRateCategories: RateCategory[] = [];

  stats = signal<StatCard[]>([]);

  // This signal provides a summary of ALL currently unprocessed jobs.
  // It's used by the file upload component.
  processedTechnicians = computed(() => {
    // A dummy date range that won't match any adjustments. 
    // This computed is for a quick summary on the upload tab, not a real payroll.
    const distantPast = new Date(0);
    return this.processPayrollForJobs(this.jobs(), distantPast, distantPast);
  });

  constructor() {
    this.loadFromLocalStorage();

    effect(() => {
      const techs = this.processedTechnicians();
      const totalJobs = techs.reduce((sum, tech) => sum + tech.totalJobs, 0);
      const totalPayout = techs.reduce((sum, tech) => sum + tech.totalEarnings, 0);
      const companyRevenue = techs.reduce((sum, tech) => sum + tech.companyRevenue, 0);
      const totalEmployees = this.users().filter(u => u.role !== 'admin').length;

      this.stats.set([
          { label: 'Total Employees', value: totalEmployees.toString(), icon: '👥', color: 'bg-blue-500' },
          { label: 'Weekly Jobs', value: totalJobs.toString(), icon: '🛠️', color: 'bg-indigo-500' },
          { label: 'Weekly Payout', value: `$${totalPayout.toFixed(2)}`, icon: '💰', color: 'bg-emerald-500' },
          { label: 'Company Revenue', value: `$${companyRevenue.toFixed(2)}`, icon: '🏢', color: 'bg-amber-500' },
      ]);
    });

    effect(() => {
      this.saveToLocalStorage(this.storageKeys.users, this.users());
      this.saveToLocalStorage(this.storageKeys.jobs, this.jobs());
      this.saveToLocalStorage(this.storageKeys.rateCategories, this.rateCategories());
      this.saveToLocalStorage(this.storageKeys.adjustments, this.adjustments());
      this.saveToLocalStorage(this.storageKeys.publishedPayrolls, this.publishedPayrolls());
      this.saveToLocalStorage(this.storageKeys.loans, this.loans());
      this.saveToLocalStorage(this.storageKeys.recurringAdjustments, this.recurringAdjustments());
      this.saveToLocalStorage(this.storageKeys.employeeReports, this.employeeReports());
    });
  }

  private loadFromLocalStorage(): void {
    const storedUsers = this.load<User[]>(this.storageKeys.users);
    this.users.set(storedUsers && storedUsers.length > 0 ? storedUsers : this.initialUsers);
    
    const storedRateCategories = this.load<RateCategory[]>(this.storageKeys.rateCategories);
    this.rateCategories.set(storedRateCategories ? storedRateCategories : this.initialRateCategories);

    this.jobs.set(this.load<Job[]>(this.storageKeys.jobs) || []);
    this.adjustments.set(this.load<Adjustment[]>(this.storageKeys.adjustments) || []);
    this.publishedPayrolls.set(this.load<PublishedPayroll[]>(this.storageKeys.publishedPayrolls) || []);
    this.loans.set(this.load<Loan[]>(this.storageKeys.loans) || []);
    this.recurringAdjustments.set(this.load<RecurringAdjustment[]>(this.storageKeys.recurringAdjustments) || []);
    this.employeeReports.set(this.load<EmployeePayrollReport[]>(this.storageKeys.employeeReports) || []);
  }

  private load<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (e) {
      console.error(`Error loading data from localStorage for key "${key}"`, e);
      return null;
    }
  }

  private saveToLocalStorage(key: string, data: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error(`Error saving data to localStorage for key "${key}"`, e);
    }
  }

  // USER METHODS
  addUser(user: Omit<User, 'id' | 'hireDate'>) {
    const existingUser = this.users().find(u => u.techId === user.techId || u.username === user.username);
    if (existingUser) {
      throw new Error(`User with techId ${user.techId} or username ${user.username} already exists.`);
    }
    const newUser: User = {
      ...user,
      id: Math.max(...this.users().map(u => u.id), 0) + 1,
      hireDate: new Date().toISOString().split('T')[0],
    };
    this.users.update(users => [...users, newUser]);
  }
  
  addPlaceholderUsers(techIds: string[]): void {
    const currentUsers = this.users();
    const existingTechIds = new Set(currentUsers.map(u => u.techId));
    let maxId = Math.max(...currentUsers.map(u => u.id).filter(id => !isNaN(id)), 0);

    const firstCategoryId = this.rateCategories()[0]?.id;
    const newUsers: User[] = [];

    for (const techId of techIds) {
        if (techId && !existingTechIds.has(techId)) {
            maxId++;
            const newUser: User = {
                id: maxId,
                name: `User (Tech ID: ${techId})`,
                username: `user_${techId}`,
                password: techId, // Default password is the techId
                techId: techId,
                email: `user+${techId}@example.com`,
                phone: 'N/A',
                hireDate: new Date().toISOString().split('T')[0],
                role: 'employee',
                rateCategoryId: firstCategoryId,
            };
            newUsers.push(newUser);
            existingTechIds.add(techId); // Add to set to handle duplicates in input techIds array
        }
    }
    
    if (newUsers.length > 0) {
        this.users.update(users => [...users, ...newUsers]);
    }
  }

  updateUser(updatedUser: User) {
     const existingUser = this.users().find(u => 
      u.id !== updatedUser.id && 
      (u.techId === updatedUser.techId || u.username === updatedUser.username)
    );
    if (existingUser) {
      throw new Error(`Another user with techId ${updatedUser.techId} or username ${updatedUser.username} already exists.`);
    }
    this.users.update(users => users.map(user => user.id === updatedUser.id ? updatedUser : user));
  }

  deleteUser(userId: number) {
    const allUsers = this.users();
    const userToDelete = allUsers.find(u => u.id === userId);

    if (!userToDelete) {
        throw new Error(`Attempted to delete non-existent user with ID: ${userId}`);
    }

    if (userToDelete.role === 'admin') {
        throw new Error("The main administrator account cannot be deleted.");
    }

    // Prevent deletion if user has finalized payrolls
    const hasFinalizedPayroll = this.publishedPayrolls().some(p => 
        p.status === 'finalized' && 
        p.reportData.some(rd => rd.techId === userToDelete.techId)
    );

    if (hasFinalizedPayroll) {
        throw new Error("Cannot delete this user because they have finalized payroll records. This is to preserve historical data integrity.");
    }

    const techIdToDelete = userToDelete.techId;

    // --- Compute all new states first ---
    const newJobs = this.jobs().filter(j => j.techId !== techIdToDelete);
    const newAdjustments = this.adjustments().filter(a => a.techId !== techIdToDelete);
    const newLoans = this.loans().filter(l => l.techId !== techIdToDelete);
    const newRecurringAdjs = this.recurringAdjustments().filter(adj => adj.techId !== techIdToDelete);
    const newEmployeeReports = this.employeeReports().filter(r => r.userId !== userId);
    
    // Only filter users out of DRAFT payrolls. Finalized ones are protected by the check above.
    // Also, remove any draft payroll that becomes empty after the user is removed.
    const newPublishedPayrolls = this.publishedPayrolls()
        .map(p => {
            if (p.status === 'draft') {
                return {
                    ...p,
                    reportData: p.reportData.filter(rd => rd.techId !== techIdToDelete)
                };
            }
            return p;
        })
        .filter(p => p.status === 'finalized' || p.reportData.length > 0);

    // Start with the current user list to perform updates.
    let usersWithUnassignments = allUsers;

    // If deleting a sub-admin, unassign their employees first.
    if (userToDelete.role === 'sub-admin') {
      usersWithUnassignments = usersWithUnassignments.map(user => 
        user.assignedTo === userId ? { ...user, assignedTo: undefined } : user
      );
    }

    // Then, filter out the user to be deleted.
    const finalUsers = usersWithUnassignments.filter(u => u.id !== userId);
    
    // --- Atomically apply all state changes ---
    this.jobs.set(newJobs);
    this.adjustments.set(newAdjustments);
    this.loans.set(newLoans);
    this.recurringAdjustments.set(newRecurringAdjs);
    this.employeeReports.set(newEmployeeReports);
    this.publishedPayrolls.set(newPublishedPayrolls);
    this.users.set(finalUsers);
  }

  assignEmployeeToSubAdmin(employeeId: number, subAdminId: number) {
    this.users.update(users => users.map(user => user.id === employeeId ? { ...user, assignedTo: subAdminId } : user));
  }

  unassignEmployee(employeeId: number) {
     this.users.update(users => users.map(user => user.id === employeeId ? { ...user, assignedTo: undefined } : user));
  }

  // JOB METHODS
  addJobs(newJobs: Omit<Job, 'id'>[]) {
    this.jobs.update(existingJobs => {
        const maxId = Math.max(0, ...existingJobs.map(j => j.id));
        const jobsWithIds = newJobs.map((job, index) => ({...job, id: maxId + index + 1}));
        return [...existingJobs, ...jobsWithIds];
    });
  }

  updateJob(updatedJob: Job) {
    this.jobs.update(jobs => jobs.map(j => j.id === updatedJob.id ? updatedJob : j));
  }

  deleteJob(jobId: number) {
    this.jobs.update(jobs => jobs.filter(j => j.id !== jobId));
  }

  clearJobs() {
    this.jobs.set([]);
    this.adjustments.set([]);
  }

  // RATE CATEGORY METHODS
  addRateCategory(name: string) {
    const existingIds = this.rateCategories().map(rc => rc.id).filter(id => typeof id === 'number' && !isNaN(id));
    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    const newCategory: RateCategory = {
      id: maxId + 1,
      name,
      rates: []
    };
    this.rateCategories.update(categories => [...categories, newCategory]);
  }

  updateRatesForCategory(categoryId: number, newRates: Rate[]) {
    this.rateCategories.update(categories => categories.map(cat => 
        cat.id === categoryId ? { ...cat, rates: newRates } : cat
    ));
  }

  updateRateCategory(categoryId: number, newName: string) {
    const existing = this.rateCategories().find(c => c.name.toLowerCase() === newName.toLowerCase() && c.id !== categoryId);
    if (existing) {
        throw new Error(`A category with the name "${newName}" already exists.`);
    }
    this.rateCategories.update(categories => 
      categories.map(cat => cat.id === categoryId ? { ...cat, name: newName } : cat)
    );
  }
  
  deleteRateCategory(categoryId: number) {
    const isAssigned = this.users().some(user => user.rateCategoryId === categoryId);
    if (isAssigned) {
      throw new Error("Cannot delete this category because it is currently assigned to one or more users.");
    }
    this.rateCategories.update(categories => categories.filter(cat => cat.id !== categoryId));
  }

  // ADJUSTMENT METHODS
  addOneTimeAdjustment(adjustment: Omit<Adjustment, 'id'>) {
    const newAdjustment: Adjustment = { ...adjustment, id: Date.now() + Math.random() };
    this.adjustments.update(adjustments => [...adjustments, newAdjustment]);
  }

  addLoan(loan: Omit<Loan, 'id'>) {
    const newLoan: Loan = { ...loan, id: Date.now() };
    this.loans.update(loans => [...loans, newLoan]);
  }
  
  updateLoan(updatedLoan: Loan) {
      this.loans.update(loans => loans.map(l => l.id === updatedLoan.id ? updatedLoan : l));
  }

  addRecurringAdjustment(adjustment: Omit<RecurringAdjustment, 'id'>) {
    const newAdjustment: RecurringAdjustment = { ...adjustment, id: Date.now() };
    this.recurringAdjustments.update(adjustments => [...adjustments, newAdjustment]);
  }
  
  updateRecurringAdjustment(updatedAdjustment: RecurringAdjustment) {
      this.recurringAdjustments.update(adjustments => adjustments.map(a => a.id === updatedAdjustment.id ? updatedAdjustment : a));
  }


  // PAYROLL PROCESSING
  processPayrollForJobs(jobsToProcess: Job[], reportStartDate: Date, reportEndDate: Date): ProcessedTechnician[] {
    const currentUsers = this.users();
    const currentRateCategories = this.rateCategories();
    const currentAdjustments = this.adjustments();
    const currentLoans = this.loans();
    const currentRecurringAdjustments = this.recurringAdjustments();

    type TechDataInProgress = {
      id: number; name: string; techId: string; totalJobs: number;
      totalRevenue: number; baseEarnings: number; adjustments: Adjustment[];
    };

    const techDataMap = new Map<string, TechDataInProgress>();

    currentUsers.forEach(user => {
      if (user.role === 'employee' || user.role === 'sub-admin') {
        techDataMap.set(user.techId, {
          id: user.id, name: user.name, techId: user.techId,
          totalJobs: 0, totalRevenue: 0, baseEarnings: 0, adjustments: [],
        });
      }
    });

    techDataMap.forEach(tech => {
      // Recurring Adjustments (applied weekly regardless of date)
      currentRecurringAdjustments
        .filter(ra => ra.techId === tech.techId && ra.isActive)
        .forEach(ra => {
          tech.adjustments.push({
            id: Date.now() + Math.random(), techId: tech.techId, date: '', type: 'Equipment Rental',
            description: ra.description, amount: ra.weeklyAmount,
          });
        });

      // Loan Payments (applied weekly regardless of date)
      currentLoans
        .filter(l => l.techId === tech.techId && l.isActive && l.remainingAmount > 0)
        .forEach(l => {
          const paymentAmount = Math.min(l.remainingAmount, l.weeklyDeduction);
          tech.adjustments.push({
            id: Date.now() + Math.random(), techId: tech.techId, date: '', type: 'Loan Payment',
            description: l.description, amount: -paymentAmount,
          });
        });
      
      // One-time adjustments (filtered by date range)
      const oneTimeAdjustmentsForPeriod = currentAdjustments.filter(adj => {
        if (adj.techId !== tech.techId) return false;
        const adjDate = this.parseDateAsUTC(adj.date);
        return adjDate >= reportStartDate && adjDate <= reportEndDate;
      });
      tech.adjustments.push(...oneTimeAdjustmentsForPeriod);
    });

    jobsToProcess.forEach(job => {
      const tech = techDataMap.get(job.techId);
      if (!tech) return;

      const user = currentUsers.find(u => u.techId === job.techId);
      if (!user || user.rateCategoryId === undefined) return;

      const category = currentRateCategories.find(rc => rc.id === user.rateCategoryId);
      const rates = category?.rates ?? [];
      const rateMap = new Map(rates.map(r => [r.taskCode.toLowerCase().trim(), r.rate]));
      
      const rate = rateMap.get(job.taskCode.toLowerCase().trim()) ?? 0;
      
      tech.totalJobs += 1;
      tech.totalRevenue += job.revenue;
      tech.baseEarnings += (rate * job.quantity);
    });

    const finalData: ProcessedTechnician[] = Array.from(techDataMap.values())
      .map(techInProgress => {
        const adjustmentTotal = techInProgress.adjustments.reduce((sum, adj) => sum + adj.amount, 0);
        const finalTotalEarnings = techInProgress.baseEarnings + adjustmentTotal;
        const finalCompanyRevenue = techInProgress.totalRevenue - finalTotalEarnings;
        const finalAvgPerJob = techInProgress.totalJobs > 0 ? finalTotalEarnings / techInProgress.totalJobs : 0;

        return {
          id: techInProgress.id, name: techInProgress.name, techId: techInProgress.techId,
          totalJobs: techInProgress.totalJobs, totalRevenue: techInProgress.totalRevenue,
          totalEarnings: finalTotalEarnings, companyRevenue: finalCompanyRevenue,
          avgPerJob: finalAvgPerJob, adjustments: techInProgress.adjustments,
        };
      })
      .filter(tech => tech.totalJobs > 0 || tech.adjustments.length > 0);

    return finalData;
  }

  // PAYROLL PUBLISHING
  publishPayroll(reportToPublish: ProcessedTechnician[], jobsInReport: Job[], startDate: string, endDate: string): string | null {
    if (jobsInReport.length === 0 && reportToPublish.every(r => r.adjustments.length === 0)) {
        throw new Error("There are no jobs or adjustments in the selected period to publish.");
    }

    // --- PREPARE NEW DATA ---
    const newPayrollId = `${startDate}_${endDate}_${Date.now()}`;
    const newPayroll: PublishedPayroll = {
        id: newPayrollId,
        startDate,
        endDate,
        publishedDate: new Date().toISOString().split('T')[0],
        reportData: reportToPublish,
        status: 'draft'
    };

    // --- COMPUTE ALL NEW STATES ---
    const currentLoans = this.loans();
    const newLoans = currentLoans.map(loan => {
        if (!loan.isActive) return loan;
        const techReport = reportToPublish.find(r => r.techId === loan.techId);
        const loanPayment = techReport?.adjustments.find(a => a.type === 'Loan Payment' && a.description === loan.description);
        if (loanPayment) {
            const newRemaining = loan.remainingAmount + loanPayment.amount; // amount is negative
            return { ...loan, remainingAmount: newRemaining, isActive: newRemaining > 0 };
        }
        return loan;
    });

    const newEmployeeReportsForThisPayroll: EmployeePayrollReport[] = [];
    reportToPublish.forEach(techReport => {
        const user = this.users().find(u => u.techId === techReport.techId);
        if (user) {
            newEmployeeReportsForThisPayroll.push({
                id: `${newPayrollId}_${user.id}`, userId: user.id, payrollId: newPayrollId,
                startDate: newPayroll.startDate, endDate: newPayroll.endDate,
                publishedDate: newPayroll.publishedDate, reportData: techReport,
                status: 'draft',
            });
        }
    });
    const allNewEmployeeReports = [...this.employeeReports(), ...newEmployeeReportsForThisPayroll];

    const allNewPublishedPayrolls = [...this.publishedPayrolls(), newPayroll].sort((a,b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    
    const jobsToPublishIds = new Set(jobsInReport.map(j => j.id));
    const newJobs = this.jobs().filter(job => !jobsToPublishIds.has(job.id));

    const oneTimeAdjustmentIds = new Set<number>();
    reportToPublish.forEach(tech => {
        tech.adjustments.forEach(adj => {
            if (adj.type === 'Bonus' || adj.type === 'Chargeback') {
                oneTimeAdjustmentIds.add(adj.id);
            }
        });
    });

    const newAdjustments = this.adjustments().filter(adj => !oneTimeAdjustmentIds.has(adj.id));


    // --- ATOMICALLY APPLY ALL STATE CHANGES ---
    this.loans.set(newLoans);
    this.employeeReports.set(allNewEmployeeReports);
    this.publishedPayrolls.set(allNewPublishedPayrolls);
    this.jobs.set(newJobs);
    this.adjustments.set(newAdjustments);
    
    alert(`Payroll DRAFT for ${startDate} to ${endDate} has been created. Finalize it in 'Payroll History' to make it visible to employees.`);
    return newPayrollId;
  }

  // NEW PAYROLL STATUS METHODS
  finalizePayroll(payrollId: string) {
    this.publishedPayrolls.update(payrolls => 
      payrolls.map(p => p.id === payrollId ? { ...p, status: 'finalized' } : p)
    );
    this.employeeReports.update(reports => 
      reports.map(r => r.payrollId === payrollId ? { ...r, status: 'finalized' } : r)
    );
  }

  unfinalizePayroll(payrollId: string) {
    this.publishedPayrolls.update(payrolls => 
      payrolls.map(p => p.id === payrollId ? { ...p, status: 'draft' } : p)
    );
    this.employeeReports.update(reports => 
      reports.map(r => r.payrollId === payrollId ? { ...r, status: 'draft' } : r)
    );
  }

  deletePayroll(payrollId: string) {
    const payrollToDelete = this.publishedPayrolls().find(p => p.id === payrollId);
    if (!payrollToDelete) return;
    if (payrollToDelete.status === 'finalized') {
      alert('Cannot delete a finalized payroll. Please un-finalize it first to hide it, then you can delete it.');
      return;
    }

    if (confirm('Are you sure you want to permanently delete this draft? This action cannot be undone.')) {
      this.publishedPayrolls.update(payrolls => payrolls.filter(p => p.id !== payrollId));
      this.employeeReports.update(reports => reports.filter(r => r.payrollId !== payrollId));
    }
  }

  public parseDateAsUTC(dateString: string): Date {
    const parts = dateString.split('-').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      const [year, month, day] = parts;
      return new Date(Date.UTC(year, month - 1, day));
    }
    return new Date('invalid');
  }

  public getStartOfWeek(date: Date): Date {
      const dt = this.parseDateAsUTC(date.toISOString().split('T')[0]);
      const day = dt.getUTCDay(); // 0 for Sunday
      dt.setUTCDate(dt.getUTCDate() - day);
      return dt;
  }
}
