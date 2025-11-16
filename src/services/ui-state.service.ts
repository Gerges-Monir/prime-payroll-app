import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class UiStateService {
  /**
   * A signal to instruct the PayrollHistoryComponent to select a specific payroll.
   * This is set by the AdminDashboardComponent after a payroll is published.
   * The PayrollHistoryComponent listens to this and resets it to null after handling.
   */
  navigateToPayrollId = signal<string | null>(null);
}