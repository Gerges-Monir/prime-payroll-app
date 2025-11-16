import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { MockDataService } from '../../services/mock-data.service';
import { UiStateService } from '../../services/ui-state.service';
import { PublishedPayroll, ProcessedTechnician } from '../../models/payroll.model';

@Component({
  selector: 'app-payroll-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './payroll-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayrollHistoryComponent {
  private dataService = inject(MockDataService);
  private uiStateService = inject(UiStateService);

  publishedPayrolls = this.dataService.publishedPayrolls;
  selectedPayrollId = signal<string | null>(null);

  selectedPayroll = computed(() => {
    const id = this.selectedPayrollId();
    if (!id) return null;
    const payroll = this.publishedPayrolls().find(p => p.id === id) ?? null;
    // If the selected payroll was deleted, reset the selection
    if (!payroll && id) {
      this.selectedPayrollId.set(null);
    }
    return payroll;
  });

  constructor() {
    effect(() => {
      const payrollId = this.uiStateService.navigateToPayrollId();
      if (payrollId) {
        this.selectedPayrollId.set(payrollId);
        this.uiStateService.navigateToPayrollId.set(null); // Reset after navigation
      }
    }, { allowSignalWrites: true });
  }

  selectPayroll(payrollId: string) {
    this.selectedPayrollId.set(payrollId);
  }

  finalize(payrollId: string, event: MouseEvent) {
    event.stopPropagation();
    if (confirm('Are you sure you want to finalize this payroll? It will become visible to all employees in the report.')) {
      this.dataService.finalizePayroll(payrollId);
    }
  }

  unfinalize(payrollId: string, event: MouseEvent) {
    event.stopPropagation();
    if (confirm('Are you sure you want to un-finalize this payroll? It will be hidden from employees until finalized again.')) {
      this.dataService.unfinalizePayroll(payrollId);
    }
  }

  delete(payrollId: string, event: MouseEvent) {
    event.stopPropagation();
    this.dataService.deletePayroll(payrollId);
  }

  getAdjustmentsTotal(tech: ProcessedTechnician): number {
    return tech.adjustments.reduce((sum, adj) => sum + adj.amount, 0);
  }
}