import { Component, ChangeDetectionStrategy, signal, inject, WritableSignal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { User } from '../../models/payroll.model';
import { DatabaseService } from '../../services/database.service';
import { AuthService } from '../../services/auth.service';
import { UiStateService, AdminTab } from '../../services/ui-state.service';
import { NotificationService } from '../../services/notification.service';
import { DashboardHeaderComponent } from '../shared/dashboard-header/dashboard-header.component';
import { StatCardsComponent } from '../shared/stat-cards/stat-cards.component';
import { FileUploadComponent } from '../shared/file-upload/file-upload.component';
import { GloFiberUploadComponent } from '../glo-fiber-upload/glo-fiber-upload.component';
import { BrightspeedManualEntryComponent } from '../brightspeed-manual-entry/brightspeed-manual-entry.component';
import { RateManagementComponent } from '../rate-management/rate-management.component';
import { ManageCompaniesComponent } from '../manage-companies/manage-companies.component';
import { BonusesDeductionsComponent } from '../bonuses-deductions/bonuses-deductions.component';
import { WeeklyReportsComponent } from '../weekly-reports/weekly-reports.component';
import { JobManagementComponent } from '../job-management/job-management.component';
import { PayrollHistoryComponent } from '../payroll-history/payroll-history.component';
import { CompanySettingsComponent } from '../company-settings/company-settings.component';
import { SidebarComponent } from '../shared/sidebar/sidebar.component';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';
import { PaystubViewerComponent } from '../paystub-viewer/paystub-viewer.component';
import { PerformanceManagementComponent } from '../performance-management/performance-management.component';
import { PayrollSummaryComponent } from '../payroll-summary/payroll-summary.component';
import { ChargebackManagementComponent } from '../chargeback-management/chargeback-management.component';
import { ChargebackHistoryComponent } from '../chargeback-history/chargeback-history.component';
import { ApplicationsComponent } from '../applications/applications.component';
import { JobOpeningsManagementComponent } from '../job-openings-management/job-openings-management.component';
import { TeamAnalysisComponent } from '../team-analysis/team-analysis.component';
import { PrimePerformanceComponent } from '../prime-performance/prime-performance.component';
import { PrimePerformanceTrackingComponent } from '../prime-performance-tracking/prime-performance-tracking.component';
import { QcManagementComponent } from '../qc-management/qc-management.component';
import { QcViewerComponent } from '../qc-viewer/qc-viewer.component';
import { RevenueAnalysisComponent } from '../supervisors/supervisors.component';
import { TaxFormsComponent } from '../tax-forms/tax-forms.component';


@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  templateUrl: './admin-dashboard.component.html',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SidebarComponent,
    DashboardHeaderComponent,
    StatCardsComponent,
    FileUploadComponent,
    GloFiberUploadComponent,
    BrightspeedManualEntryComponent,
    RateManagementComponent,
    ManageCompaniesComponent,
    BonusesDeductionsComponent,
    WeeklyReportsComponent,
    JobManagementComponent,
    PayrollHistoryComponent,
    CompanySettingsComponent,
    ConfirmationModalComponent,
    PaystubViewerComponent,
    PerformanceManagementComponent,
    PayrollSummaryComponent,
    ChargebackManagementComponent,
    ChargebackHistoryComponent,
    ApplicationsComponent,
    JobOpeningsManagementComponent,
    TeamAnalysisComponent,
    PrimePerformanceComponent,
    PrimePerformanceTrackingComponent,
    QcManagementComponent,
    QcViewerComponent,
    RevenueAnalysisComponent,
    TaxFormsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboardComponent {
  private dataService = inject(DatabaseService);
  private authService = inject(AuthService);
  private uiStateService = inject(UiStateService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  readonly currentUser = this.authService.currentUser;
  activeTab = this.uiStateService.adminActiveTab as WritableSignal<AdminTab>;
  
  stats = this.dataService.stats;
  allUsers = this.dataService.users;
  users = computed(() => this.allUsers().filter(u => u.role === 'employee' || u.role === 'sub-admin' || u.role === 'supervisor' || u.role === 'admin'));
  rateCategories = this.dataService.rateCategories;
  rateCategoriesExist = computed(() => this.rateCategories().length > 0);
  
  showUserModal = signal(false);
  isSavingUser = signal(false);
  isSendingReset = signal(false);
  userToEdit: WritableSignal<User | null> = signal(null);
  userForm: FormGroup;
  
  private userMap = computed(() => new Map(this.allUsers().map(u => [u.id, u])));

  // Signals for delete confirmation
  showDeleteUserConfirm = signal(false);
  userToDelete = signal<User | null>(null);

  tabs: { id: AdminTab; name: string; icon: string }[] = [
    { id: 'dashboard', name: 'Dashboard', icon: 'dashboard' },
    { id: 'upload', name: 'Upload Payroll', icon: 'upload' },
    { id: 'gloFiberUpload', name: 'Glo Fiber Upload', icon: 'upload' },
    { id: 'brightspeedEntry', name: 'Brightspeed Manual Entry', icon: 'edit' },
    { id: 'jobs', name: 'Manage Jobs', icon: 'jobs' },
    { id: 'users', name: 'Manage Employees', icon: 'users' },
    { id: 'applications', name: 'Applications', icon: 'applications' },
    { id: 'jobOpenings', name: 'Job Openings', icon: 'applications' },
    { id: 'rates', name: 'Manage Rates', icon: 'rates' },
    { id: 'manageCompanies', name: 'Manage Companies', icon: 'assign' },
    { id: 'publish', name: 'Adjustments', icon: 'publish' },
    { id: 'analytics', name: 'Process & Analyze', icon: 'analytics' },
    { id: 'history', name: 'Payroll History', icon: 'history' },
    { id: 'summary', name: 'Payroll Summary', icon: 'summary' },
    { id: 'revenueAnalysis', name: 'Revenue Analysis', icon: 'analysis' },
    { id: 'teamAnalysis', name: 'Performance Datasets', icon: 'analysis' },
    { id: 'primePerformance', name: 'Bulk Reports & Trends', icon: 'rates' },
    { id: 'primePerformanceTracking', name: 'Performance Tracking', icon: 'trending' },
    { id: 'qcTemplates', name: 'QC Form Templates', icon: 'jobs' },
    { id: 'qcSubmissions', name: 'QC Submissions', icon: 'paystubs' },
    { id: 'performance', name: 'Individual Reports', icon: 'performance' },
    { id: 'paystubs', name: 'Paystub Viewer', icon: 'paystubs' },
    { id: '1099-forms', name: '1099 Forms', icon: 'tax' },
    { id: 'chargebacks', name: 'Upload Chargebacks', icon: 'chargebacks' },
    { id: 'chargebackHistory', name: 'Chargeback History', icon: 'history' },
    { id: 'settings', name: 'Settings', icon: 'settings' }
  ];

  constructor() {
    this.fb = inject(FormBuilder);
    this.userForm = this.fb.group({
      id: [null],
      name: ['', Validators.required],
      username: ['', Validators.required],
      techId: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', Validators.required],
      role: ['employee', Validators.required],
      password: [''],
      rateCategoryId: [null],
      // 1099 Fields
      tin: [''],
      addressLine1: [''],
      addressLine2: [''],
      city: [''],
      state: [''],
      zipCode: [''],
    });
  }

  selectTab(tab: AdminTab): void {
    this.activeTab.set(tab);
  }

  logout(): void {
    this.authService.logout();
  }
  
  getEffectiveRateCategoryInfo(user: User): { name: string; isInherited: boolean } {
    const rateCategories = this.rateCategories();
    
    // Direct assignment
    if (user.rateCategoryId) {
      const category = rateCategories.find(c => c.id === user.rateCategoryId);
      return { name: category?.name || 'Unknown Category', isInherited: false };
    }
    
    // Inherited from sub-admin
    if (user.assignedTo) {
      const subAdmin = this.userMap().get(user.assignedTo);
      if (subAdmin && subAdmin.rateCategoryId) {
        const category = rateCategories.find(c => c.id === subAdmin.rateCategoryId);
        return { name: category?.name || 'Unknown Category', isInherited: true };
      }
    }

    return { name: 'Not Assigned', isInherited: false };
  }

  hasInvalidEmail(user: User): boolean {
    if (!user.email || user.email.trim() === '') {
      return true;
    }
    if (user.email.startsWith('tech') && user.email.endsWith('@primecommunication.com')) {
      return true;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return !emailRegex.test(user.email);
  }

  needsActivation(user: User): boolean {
    return !user.uid;
  }

  openNewUserModal(): void {
    this.userToEdit.set(null);
    const allRateCategories = this.rateCategories();
    const standardCategory = allRateCategories.find(c => c.name.toLowerCase() === 'standard');
    const defaultRateCategoryId = standardCategory ? standardCategory.id : null;
    this.userForm.reset({ role: 'employee', rateCategoryId: defaultRateCategoryId });
    this.userForm.get('password')?.setValidators([Validators.required, Validators.minLength(6)]);
    this.userForm.get('username')?.enable();
    this.userForm.get('email')?.enable();
    this.userForm.get('role')?.enable();
    this.userForm.updateValueAndValidity();
    this.showUserModal.set(true);
  }

  openCreateUserModal(data: { techId: string; name: string }): void {
    this.userToEdit.set(null);
    const allRateCategories = this.rateCategories();
    const standardCategory = allRateCategories.find(c => c.name.toLowerCase() === 'standard');
    const defaultRateCategoryId = standardCategory ? standardCategory.id : null;
    
    this.userForm.reset({ 
      role: 'employee', 
      rateCategoryId: defaultRateCategoryId,
      name: data.name,
      techId: data.techId,
      username: data.techId // Default username to techId
    });
    
    this.userForm.get('password')?.setValidators([Validators.required, Validators.minLength(6)]);
    this.userForm.get('username')?.enable();
    this.userForm.get('email')?.enable();
    this.userForm.get('role')?.enable();
    this.userForm.updateValueAndValidity();
    this.showUserModal.set(true);
  }

  openEditUserModal(user: User): void {
    this.userToEdit.set(user);
    this.userForm.patchValue(user);

    if (!user.uid) { // Placeholder user: treat as activation
      this.userForm.get('password')?.setValidators([Validators.required, Validators.minLength(6)]);
      this.userForm.get('username')?.enable();
      this.userForm.get('email')?.enable();
    } else { // Active user: treat as edit
      this.userForm.get('password')?.clearValidators();
      this.userForm.get('username')?.disable();
      this.userForm.get('email')?.enable();
    }
    
    if (user.id === this.currentUser()?.id) {
        this.userForm.get('role')?.disable();
    } else {
        this.userForm.get('role')?.enable();
    }
    
    this.userForm.updateValueAndValidity();
    this.showUserModal.set(true);
  }

  closeUserModal(): void {
    this.showUserModal.set(false);
  }

  async saveUser(): Promise<void> {
    if (this.userForm.invalid) {
      this.notificationService.showError('Please fill out all required fields correctly.');
      return;
    }
    
    this.isSavingUser.set(true);
    await new Promise(resolve => setTimeout(resolve, 500)); 

    const formValue = this.userForm.getRawValue();
    const editingUser = this.userToEdit();
    
    try {
      if (editingUser) { // Existing user document in Firestore
        if (editingUser.uid) { // Fully active user, so it's an UPDATE
          const emailChanged = editingUser.email !== formValue.email;
          const updatedUserData: User = { ...editingUser, ...formValue };
          delete updatedUserData.password;
          
          await this.dataService.updateUser(updatedUserData);

          if (emailChanged) {
            this.notificationService.show(
              `User '${updatedUserData.name}' updated. IMPORTANT: You must manually update their email in the Firebase Authentication console from '${editingUser.email}' to '${formValue.email}' to ensure they can log in.`,
              'info',
              15000 
            );
          } else {
            this.notificationService.showSuccess(`User '${updatedUserData.name}' updated successfully.`);
          }
        } else { // Placeholder user, so it's an ACTIVATION
            if (!formValue.password) {
              this.notificationService.showError('Password is required to activate a new user.');
              this.isSavingUser.set(false);
              return;
            }
            // Step 1: Create user in Firebase Authentication
            const authResult = await this.authService.createUser(formValue.email, formValue.password);
            if (!authResult.success || !authResult.uid) {
              this.notificationService.showError(authResult.message || 'Failed to create user login.');
              this.isSavingUser.set(false);
              return;
            }
            // Step 2: Update the existing user document in Firestore with the UID
            const updatedUserData: User = { 
              ...editingUser, 
              ...formValue,
              uid: authResult.uid 
            };
            delete updatedUserData.password;
            
            await this.dataService.updateUser(updatedUserData);
            this.notificationService.showSuccess(`User '${updatedUserData.name}' activated successfully and can now log in.`);
        }
      } else { // No existing user document, so it's a completely NEW user
        if (!formValue.password) {
            this.notificationService.showError('Password is required for new users.');
            this.isSavingUser.set(false);
            return;
        }
        
        // Step 1: Create user in Firebase Authentication
        const authResult = await this.authService.createUser(formValue.email, formValue.password);
        
        if (!authResult.success || !authResult.uid) {
            this.notificationService.showError(authResult.message || 'Failed to create user login.');
            this.isSavingUser.set(false);
            return;
        }

        // Step 2: Create user in Firestore database with the UID from Auth
        const { id, password, ...newUser } = formValue;
        const userToSave: Omit<User, 'id'> = {
            ...newUser,
            uid: authResult.uid,
        };
        
        await this.dataService.addUser(userToSave);
        this.notificationService.showSuccess(`User '${userToSave.name}' created successfully and can now log in.`);
      }
      this.closeUserModal();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred.';
        this.notificationService.showError(errorMessage);
    } finally {
        this.isSavingUser.set(false);
    }
  }
  
  async sendPasswordReset(email: string): Promise<void> {
    this.isSendingReset.set(true);
    const result = await this.authService.sendPasswordResetEmail(email);
    if (result.success) {
      this.notificationService.showSuccess(`Password reset email sent to ${email}.`);
      this.closeUserModal();
    } else {
      this.notificationService.showError(result.message || 'Failed to send reset email.');
    }
    this.isSendingReset.set(false);
  }

  deleteUser(user: User): void {
    this.userToDelete.set(user);
    this.showDeleteUserConfirm.set(true);
  }
  
  async handleUserDelete(confirmed: boolean): Promise<void> {
    const user = this.userToDelete();
    this.showDeleteUserConfirm.set(false);

    if (confirmed && user) {
        if (user.uid) {
            this.notificationService.show(
                'Active users cannot be deleted from the dashboard. Please use the Firebase console to ensure both authentication and database records are removed.',
                'error',
                8000
            );
            this.userToDelete.set(null);
            return;
        }
        try {
            await this.dataService.deleteUser(String(user.id));
            this.notificationService.showSuccess(`User '${user.name}' deleted successfully.`);
        } catch(e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this.notificationService.showError(errorMessage);
        }
    }
    this.userToDelete.set(null);
  }
}