import { Component, ChangeDetectionStrategy, signal, inject, WritableSignal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { User } from '../../models/payroll.model';
import { MockDataService } from '../../services/mock-data.service';
import { AuthService } from '../../services/auth.service';
import { UiStateService } from '../../services/ui-state.service';
import { DashboardHeaderComponent } from '../shared/dashboard-header/dashboard-header.component';
import { StatCardsComponent } from '../shared/stat-cards/stat-cards.component';
import { FileUploadComponent } from '../shared/file-upload/file-upload.component';
import { RateManagementComponent } from '../rate-management/rate-management.component';
import { AssignManagementComponent } from '../assign-management/assign-management.component';
import { BonusesDeductionsComponent } from '../bonuses-deductions/bonuses-deductions.component';
import { WeeklyReportsComponent } from '../weekly-reports/weekly-reports.component';
import { JobManagementComponent } from '../job-management/job-management.component';
import { PayrollHistoryComponent } from '../payroll-history/payroll-history.component';


type AdminTab = 'uploadJobs' | 'jobs' | 'users' | 'assign' | 'rates' | 'bonuses' | 'reports' | 'history';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  templateUrl: './admin-dashboard.component.html',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DashboardHeaderComponent,
    StatCardsComponent,
    FileUploadComponent,
    RateManagementComponent,
    AssignManagementComponent,
    BonusesDeductionsComponent,
    WeeklyReportsComponent,
    JobManagementComponent,
    PayrollHistoryComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboardComponent {
  private dataService = inject(MockDataService);
  private authService = inject(AuthService);
  private uiStateService = inject(UiStateService);
  private fb: FormBuilder;

  activeTab = signal<AdminTab>('uploadJobs');
  
  stats = this.dataService.stats;
  users = computed(() => this.dataService.users().filter(u => u.role !== 'admin'));
  rateCategories = this.dataService.rateCategories;
  rateCategoriesExist = computed(() => this.rateCategories().length > 0);
  
  showUserModal = signal(false);
  userToEdit: WritableSignal<User | null> = signal(null);
  userForm: FormGroup;

  tabs: { id: AdminTab; name: string; icon: string }[] = [
    { id: 'uploadJobs', name: 'Upload Jobs', icon: '📤' },
    { id: 'jobs', name: 'Manage Jobs', icon: '🔧' },
    { id: 'users', name: 'Manage Users', icon: '👥' },
    { id: 'assign', name: 'Assign to Sub-Admin', icon: '🧑‍✈️' },
    { id: 'rates', name: 'Rate Management', icon: '💰' },
    { id: 'bonuses', name: 'Adjustments', icon: '💸' },
    { id: 'reports', name: 'Weekly Reports', icon: '📅' },
    { id: 'history', name: 'Payroll History', icon: '📚' },
  ];

  constructor() {
    this.fb = inject(FormBuilder);
    this.userForm = this.fb.group({
      name: ['', Validators.required],
      username: ['', Validators.required],
      password: [''],
      techId: ['', Validators.required],
      email: ['', [Validators.email]],
      phone: [''],
      role: ['employee' as const, Validators.required],
      rateCategoryId: [null]
    });
  }

  selectTab(tab: AdminTab): void {
    this.activeTab.set(tab);
  }

  onPayrollPublished(payrollId: string): void {
    this.activeTab.set('history');
    this.uiStateService.navigateToPayrollId.set(payrollId);
  }

  openNewUserModal(): void {
    this.userForm.reset({ role: 'employee', rateCategoryId: this.rateCategories()[0]?.id || null });
    this.userForm.get('password')?.setValidators([Validators.required, Validators.minLength(6)]);
    this.userForm.get('password')?.updateValueAndValidity();
    this.userToEdit.set(null);
    this.showUserModal.set(true);
  }
  
  openEditUserModal(user: User): void {
    this.userToEdit.set(user);
    this.userForm.get('password')?.clearValidators();
    this.userForm.get('password')?.updateValueAndValidity();
    this.userForm.patchValue({
      name: user.name,
      username: user.username,
      techId: user.techId,
      email: user.email,
      phone: user.phone,
      role: user.role,
      rateCategoryId: user.rateCategoryId,
      password: '',
    });
    this.showUserModal.set(true);
  }

  closeUserModal(): void {
    this.showUserModal.set(false);
    this.userToEdit.set(null);
  }

  saveUser(): void {
    if (this.userForm.invalid) {
      return;
    }

    const formData = this.userForm.value;
    const editingUser = this.userToEdit();
    const rateCategoryId = formData.rateCategoryId != null ? Number(formData.rateCategoryId) : undefined;

    try {
      if (editingUser) {
        // We are editing an existing user
        const updatedUser: User = {
          ...editingUser,
          name: formData.name,
          username: formData.username,
          techId: formData.techId,
          email: formData.email,
          phone: formData.phone,
          role: formData.role,
          rateCategoryId: rateCategoryId,
          password: formData.password ? formData.password : editingUser.password,
        };
        this.dataService.updateUser(updatedUser);
      } else {
        // We are adding a new user
        const userPayload = {
          name: formData.name,
          username: formData.username,
          techId: formData.techId,
          email: formData.email,
          phone: formData.phone,
          role: formData.role,
          rateCategoryId: rateCategoryId,
          password: formData.password,
        };
        this.dataService.addUser(userPayload);
      }
      this.closeUserModal();
    } catch (error) {
       alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  deleteUser(userId: number): void {
    if (confirm('Are you sure you want to permanently delete this user? This will remove all of their unprocessed jobs and adjustments. This action CANNOT be undone and is not possible if the user has finalized payroll history.')) {
      try {
        this.dataService.deleteUser(userId);
      } catch (error) {
        console.error("Failed to delete user:", error);
        alert(`An error occurred while trying to delete the user: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  getRateCategoryName(categoryId: number | undefined): string {
    if (categoryId === undefined) {
      return 'N/A';
    }
    const category = this.rateCategories().find(rc => rc.id === categoryId);
    return category?.name || 'N/A';
  }

  logout(): void {
    this.authService.logout();
  }
}
