import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MockDataService } from '../../services/mock-data.service';
import { User } from '../../models/payroll.model';

@Component({
  selector: 'app-assign-management',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './assign-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssignManagementComponent {
  private dataService = inject(MockDataService);

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

  assign(employeeId: number) {
    const subAdminId = this.selectedSubAdminId();
    if (subAdminId) {
      this.dataService.assignEmployeeToSubAdmin(employeeId, subAdminId);
    }
  }

  unassign(employeeId: number) {
    this.dataService.unassignEmployee(employeeId);
  }
}