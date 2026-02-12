import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { UiStateService } from '../../services/ui-state.service';
import { NotificationService } from '../../services/notification.service';
import { PublishedPayroll, ProcessedTechnician } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

@Component({
  selector: 'app-payroll-history',
  standalone: true,
  imports: [CommonModule, ConfirmationModalComponent, DatePipe, CurrencyPipe],
  templateUrl: './payroll-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayrollHistoryComponent {
  private dataService = inject(DatabaseService);
  private uiStateService = inject(UiStateService);
  private notificationService = inject(NotificationService);

  publishedPayrolls = this.dataService.publishedPayrolls;
  selectedPayrollId = signal<string | null>(null);
  selectedTechnicianId = signal<string|null>(null);

  // Modal states
  showDeleteConfirm = signal(false);
  payrollToDelete = signal<PublishedPayroll | null>(null);

  selectedPayroll = computed(() => {
    const id = this.selectedPayrollId();
    if (!id) return null;
    const payroll = this.publishedPayrolls().find(p => p.id === id);
    if (!payroll && id) {
        this.selectedPayrollId.set(null);
    }
    return payroll ?? null;
  });
  
  selectedTechnicianReport = computed(() => {
      const payroll = this.selectedPayroll();
      const techId = this.selectedTechnicianId();
      if (!payroll || techId === null) return null;
      return payroll.reportData.find(tech => tech.id === techId) ?? null;
  });

  constructor() {
    effect(() => {
      const payrollId = this.uiStateService.navigateToPayrollId();
      if (payrollId) {
        this.selectedPayrollId.set(payrollId);
        this.uiStateService.navigateToPayrollId.set(null);
      }
    });
    
    // Automatically select the first payroll if none is selected
    effect(() => {
        if (!this.selectedPayrollId() && this.publishedPayrolls().length > 0) {
            this.selectedPayrollId.set(this.publishedPayrolls()[0].id);
        }
    });
  }

  selectPayroll(payrollId: string) {
    this.selectedPayrollId.set(payrollId);
    this.selectedTechnicianId.set(null); // Reset tech selection when changing payroll
  }

  toggleTechnicianDetails(techId: string) {
      if (this.selectedTechnicianId() === techId) {
          this.selectedTechnicianId.set(null);
      } else {
          this.selectedTechnicianId.set(techId);
      }
  }

  delete(payroll: PublishedPayroll, event: MouseEvent): void {
    event.stopPropagation();
    console.log(`[Payroll History] 1. Delete button clicked for payroll ID: ${payroll.id}`);
    console.log(`[Payroll History] 2. Payroll to delete:`, JSON.parse(JSON.stringify(payroll)));
    this.payrollToDelete.set(payroll);
    this.showDeleteConfirm.set(true);
  }

  async handleDelete(confirmed: boolean): Promise<void> {
    const payroll = this.payrollToDelete();
    this.showDeleteConfirm.set(false);
    if (confirmed && payroll) {
        console.log(`[Payroll History] 3. User confirmed deletion for payroll ID ${payroll.id}.`);
        try {
            await this.dataService.deletePayroll(payroll.id);
            this.notificationService.showSuccess('Payroll reports have been removed from employee dashboards.');
            console.log(`[Payroll History] 4. ✅ Successfully called dataService.deletePayroll for ID: ${payroll.id}`);
        } catch(e) {
            console.error(`[Payroll History] 5. ❌ Error deleting payroll ID ${payroll.id}:`, e);
            const msg = e instanceof Error ? e.message : String(e);
            this.notificationService.showError(msg);
        }
    } else {
        console.log(`[Payroll History] 3. Deletion cancelled for payroll ID: ${payroll?.id}`);
    }
    this.payrollToDelete.set(null);
  }

  getAdjustmentsTotal(tech: ProcessedTechnician): number {
    return tech.adjustments.reduce((sum, adj) => sum + adj.amount, 0);
  }
}