import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { User } from '../../models/payroll.model';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-manage-companies',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './manage-companies.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageCompaniesComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  users = this.dataService.users;
  rateCategories = this.dataService.rateCategories;
  selectedSubAdminId = signal<string | null>(null);

  companySettingsForm: FormGroup;
  isSaving = signal(false);

  subAdmins = computed(() => this.users().filter(u => u.role === 'sub-admin'));
  
  selectedSubAdmin = computed(() => {
    const id = this.selectedSubAdminId();
    if (!id) return null;
    return this.subAdmins().find(sa => sa.id === id) ?? null;
  });

  assignedEmployees = computed(() => {
    const subAdminId = this.selectedSubAdminId();
    if (!subAdminId) return [];
    return this.users().filter(u => u.role === 'employee' && u.assignedTo === subAdminId);
  });
  
  unassignedEmployees = computed(() => {
    return this.users().filter(u => u.role === 'employee' && !u.assignedTo);
  });

  constructor() {
    this.fb = inject(FormBuilder);
    this.companySettingsForm = this.fb.group({
      companyName: [''],
      rateCategoryId: [null, Validators.required],
      profitShare: [50, [Validators.required, Validators.min(0), Validators.max(100)]],
    });

    effect(() => {
      const subAdmin = this.selectedSubAdmin();
      if (subAdmin) {
        this.companySettingsForm.patchValue({
          companyName: subAdmin.companyName || '',
          rateCategoryId: subAdmin.rateCategoryId || null,
          profitShare: subAdmin.profitShare ?? 50,
        });
      } else {
        this.companySettingsForm.reset({ profitShare: 50 });
      }
    });
  }

  selectSubAdmin(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const id = selectElement.value || null;
    this.selectedSubAdminId.set(id);
  }

  async saveCompanySettings(): Promise<void> {
    if (this.companySettingsForm.invalid) {
      this.notificationService.showError('Please correct the errors before saving.');
      return;
    }
    const subAdmin = this.selectedSubAdmin();
    if (!subAdmin) return;

    this.isSaving.set(true);
    const formValue = this.companySettingsForm.value;
    const updatedUser: User = {
      ...subAdmin,
      companyName: formValue.companyName,
      rateCategoryId: formValue.rateCategoryId,
      profitShare: formValue.profitShare,
    };
    try {
      await this.dataService.updateUser(updatedUser);
      this.notificationService.showSuccess(`Settings for ${subAdmin.name}'s company updated.`);
    } catch (e) {
      this.notificationService.showError('Failed to save settings.');
    } finally {
      this.isSaving.set(false);
    }
  }

  async assign(employeeId: string): Promise<void> {
    const subAdminId = this.selectedSubAdminId();
    if (subAdminId) {
      this.dataService.assignEmployeeToSubAdmin(employeeId, subAdminId);
    }
  }

  async unassign(employeeId: string): Promise<void> {
    this.dataService.unassignEmployee(employeeId);
  }

  async updateEmployeeRateCategory(employeeId: string, event: Event): Promise<void> {
    const rateCategoryId = (event.target as HTMLSelectElement).value || null;
    const employee = this.users().find(u => u.id === employeeId);
    if (!employee) return;

    const updatedUser: User = { ...employee, rateCategoryId };
    try {
      await this.dataService.updateUser(updatedUser);
      this.notificationService.showSuccess(`${employee.name}'s rate category updated.`);
    } catch (e) {
       this.notificationService.showError('Failed to update rate category.');
    }
  }
}
