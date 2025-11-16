import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { UiStateService } from '../../services/ui-state.service';
import { NotificationService } from '../../services/notification.service';
import { PublishedPayroll, ProcessedTechnician } from '../../models/payroll.model';

@Component({
  selector: 'app-payroll-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './payroll-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayrollHistoryComponent {
  private dataService = inject(DatabaseService);
  private uiStateService = inject(UiStateService);
  private notificationService = inject(NotificationService);

  publishedPayrolls = this.dataService.publishedPayrolls;
  selectedPayrollId = signal<string | null>(null);
  selectedTechnicianId = signal<number|null>(null);

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
    }, { allowSignalWrites: true });
    
    // Automatically select the first payroll if none is selected
    effect(() => {
        if (!this.selectedPayrollId() && this.publishedPayrolls().length > 0) {
            this.selectedPayrollId.set(this.publishedPayrolls()[0].id);
        }
    }, { allowSignalWrites: true });
  }

  selectPayroll(payrollId: string) {
    this.selectedPayrollId.set(payrollId);
    this.selectedTechnicianId.set(null); // Reset tech selection when changing payroll
  }

  toggleTechnicianDetails(techId: number) {
      if (this.selectedTechnicianId() === techId) {
          this.selectedTechnicianId.set(null);
      } else {
          this.selectedTechnicianId.set(techId);
      }
  }

  async finalize(payrollId: string, event: MouseEvent) {
    event.stopPropagation();
    if (confirm('Finalize this payroll? It will become visible to employees.')) {
      await this.dataService.finalizePayroll(payrollId);
      this.notificationService.showSuccess('Payroll has been finalized.');
    }
  }

  async unfinalize(payrollId: string, event: MouseEvent) {
    event.stopPropagation();
    if (confirm('Un-finalize this payroll? It will be hidden from employees.')) {
      await this.dataService.unfinalizePayroll(payrollId);
      this.notificationService.showSuccess('Payroll has been moved back to drafts.');
    }
  }

  async delete(payrollId: string, event: MouseEvent) {
    event.stopPropagation();
    if (confirm('Permanently delete this draft? This cannot be undone.')) {
        try {
            await this.dataService.deletePayroll(payrollId);
            this.notificationService.showSuccess('Payroll draft deleted.');
        } catch(e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.notificationService.showError(msg);
        }
    }
  }

  getAdjustmentsTotal(tech: ProcessedTechnician): number {
    return tech.adjustments.reduce((sum, adj) => sum + adj.amount, 0);
  }
}