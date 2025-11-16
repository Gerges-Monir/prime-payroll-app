import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
// Fix: Replaced CloudDataService with DatabaseService as it was not found.
import { DatabaseService } from '../../services/database.service';
import { User } from '../../models/payroll.model';

@Component({
  selector: 'app-assign-management',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './assign-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssignManagementComponent {
  // Fix: Injected DatabaseService instead of the non-existent CloudDataService.
  private dataService = inject(DatabaseService);

  users = this.dataService.users;
  selectedSubAdminId = signal<number | null>(null);

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

  selectSubAdmin(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const id = selectElement.value ? parseInt(selectElement.value, 10) : null;
    this.selectedSubAdminId.set(id);
  }

  async assign(employeeId: number): Promise<void> {
    const subAdminId = this.selectedSubAdminId();
    if (subAdminId) {
      this.dataService.assignEmployeeToSubAdmin(employeeId, subAdminId);
    }
  }

  async unassign(employeeId: number): Promise<void> {
    this.dataService.unassignEmployee(employeeId);
  }
}
