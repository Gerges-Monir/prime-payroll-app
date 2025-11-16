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
import { RateManagementComponent } from '../rate-management/rate-management.component';
import { AssignManagementComponent } from '../assign-management/assign-management.component';
import { BonusesDeductionsComponent } from '../bonuses-deductions/bonuses-deductions.component';
import { WeeklyReportsComponent } from '../weekly-reports/weekly-reports.component';
import { JobManagementComponent } from '../job-management/job-management.component';
import { PayrollHistoryComponent } from '../payroll-history/payroll-history.component';
import { CompanySettingsComponent } from '../company-settings/company-settings.component';
import { SidebarComponent } from '../shared/sidebar/sidebar.component';


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
    RateManagementComponent,
    AssignManagementComponent,
    BonusesDeductionsComponent,
    WeeklyReportsComponent,
    JobManagementComponent,
    PayrollHistoryComponent,
    CompanySettingsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboardComponent {
  private dataService = inject(DatabaseService);
  private authService = inject(AuthService);
  private uiStateService = inject(UiStateService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  activeTab = this.uiStateService.adminActiveTab as WritableSignal<AdminTab>;
  
  stats = this.dataService.stats;
  users = computed(() => this.dataService.users().filter(u => u.role !== 'admin'));
  rateCategories = this.dataService.rateCategories;
  rateCategoriesExist = computed(() => this.rateCategories().length > 0);
  
  showUserModal = signal(false);
  isSavingUser = signal(false);
  userToEdit: WritableSignal<User | null> = signal(null);
  userForm: FormGroup;

  tabs: { id: AdminTab; name: string; icon: string }[] = [
    { id: 'dashboard', name: 'Dashboard', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 8.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 8.25 20.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6A2.25 2.25 0 0 1 15.75 3.75h2.25A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25A2.25 2.25 0 0 1 13.5 8.25V6ZM13.5 15.75A2.25 2.25 0 0 1 15.75 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />' },
    { id: 'upload', name: 'Upload Payroll', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />' },
    { id: 'jobs', name: 'Manage Jobs', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />' },
    { id: 'users', name: 'Manage Employees', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-4.663M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Z" />' },
    { id: 'rates', name: 'Manage Rates', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125-1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />' },
    { id: 'assign', name: 'Assign Sub-Admins', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.746-1.043m-2.252 2.252a8.985 8.985 0 0 1-3.642 1.5a8.985 8.985 0 0 1-3.642-1.5m6.53-4.53-3.25-3.25m0 0-3.25 3.25M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />' },
    { id: 'publish', name: 'Adjustments', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008Zm0 3h.008v.008H8.25v-.008Zm0 3h.008v.008H8.25v-.008Zm3-6h.008v.008H11.25v-.008Zm0 3h.008v.008H11.25v-.008Zm0 3h.008v.008H11.25v-.008Zm3-6h.008v.008H14.25v-.008Zm0 3h.008v.008H14.25v-.008Zm0 3h.008v.008H14.25v-.008Z M4.5 21V5.75A2.25 2.25 0 0 1 6.75 3.5h10.5a2.25 2.25 0 0 1 2.25 2.25v12.75A2.25 2.25 0 0 1 17.25 21H6.75A2.25 2.25 0 0 1 4.5 21Z" />' },
    { id: 'analytics', name: 'Process & Analyze', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" />' },
    { id: 'history', name: 'Payroll History', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />' },
    { id: 'settings', name: 'Settings', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m18 0h-1.5m-15 0H3.75m16.5 0h-1.5m-15 0H3.75m16.5 0h-1.5M12 4.5v-1.5m0 15v1.5m-6.75-12.75-1.06-1.06M19.81 19.81l-1.06-1.06M4.25 19.81l1.06-1.06M18.75 5.25l-1.06 1.06" />' }
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
    });

    this.userForm.get('role')?.valueChanges.subscribe(role => {
        if (role === 'sub-admin') {
            this.userForm.get('rateCategoryId')?.disable();
            this.userForm.get('rateCategoryId')?.setValue(null);
        } else {
            this.userForm.get('rateCategoryId')?.enable();
        }
    });
  }

  selectTab(tab: AdminTab): void {
    this.activeTab.set(tab);
  }

  logout(): void {
    this.authService.logout();
  }
  
  getRateCategoryName(id: number | undefined): string {
    if (id === undefined || id === null) return 'Not Assigned';
    return this.rateCategories().find(c => c.id === id)?.name || 'Unknown Category';
  }

  openNewUserModal(): void {
    this.userToEdit.set(null);
    this.userForm.reset({ role: 'employee', rateCategoryId: null });
    this.userForm.get('password')?.setValidators([Validators.required, Validators.minLength(4)]);
    this.userForm.updateValueAndValidity();
    this.showUserModal.set(true);
  }

  openEditUserModal(user: User): void {
    this.userToEdit.set(user);
    this.userForm.patchValue(user);
    this.userForm.get('password')?.clearValidators();
    this.userForm.get('password')?.updateValueAndValidity();
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
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate async

    const formValue = this.userForm.getRawValue();
    const editingUser = this.userToEdit();
    
    try {
      if (editingUser) {
        // Update user
        const updatedUserData: User = { ...editingUser, ...formValue };
        if (!formValue.password) {
            delete updatedUserData.password;
        }
        await this.dataService.updateUser(updatedUserData);
        this.notificationService.showSuccess(`User '${updatedUserData.name}' updated successfully.`);
      } else {
        // Add new user
        if (!formValue.password) {
            this.notificationService.showError('Password is required for new users.');
            this.isSavingUser.set(false);
            return;
        }
        const { id, ...newUser } = formValue;
        await this.dataService.addUser(newUser);
        this.notificationService.showSuccess(`User '${newUser.name}' created successfully.`);
      }
      this.closeUserModal();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred.';
        this.notificationService.showError(errorMessage);
    } finally {
        this.isSavingUser.set(false);
    }
  }

  async deleteUser(userId: number): Promise<void> {
    const user = this.users().find(u => u.id === userId);
    if (confirm(`Are you sure you want to delete ${user?.name}? This will remove them and all their unprocessed work. This action cannot be undone.`)) {
        try {
            await this.dataService.deleteUser(userId);
            this.notificationService.showSuccess(`User '${user?.name}' deleted successfully.`);
        } catch(e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this.notificationService.showError(errorMessage);
        }
    }
  }
}