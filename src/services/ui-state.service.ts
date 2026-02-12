import { Injectable, signal } from '@angular/core';

// FIX: Add 'manageCompanies' to allow it as a valid tab in the admin dashboard.
export type AdminTab = 'dashboard' | 'upload' | 'gloFiberUpload' | 'brightspeedEntry' | 'users' | 'rates' | 'publish' | 'analytics' | 'jobs' | 'history' | 'settings' | 'paystubs' | 'performance' | 'summary' | 'chargebacks' | 'chargebackHistory' | 'supervisors' | 'applications' | 'jobOpenings' | 'teamAnalysis' | 'primePerformance' | 'primePerformanceTracking' | 'qcTemplates' | 'qcSubmissions' | 'revenueAnalysis' | '1099-forms' | 'manageCompanies';


@Injectable({
  providedIn: 'root',
})
export class UiStateService {
  /**
   * Stores the currently active tab in the admin dashboard.
   */
  adminActiveTab = signal<AdminTab>('dashboard');

  /**
   * Manages the visibility of the sidebar on smaller screens.
   */
  sidebarOpen = signal(false);

  /**
   * A signal to instruct the PayrollHistoryComponent to select a specific payroll.
   * This is set by the AdminDashboardComponent after a payroll is published.
   * The PayrollHistoryComponent listens to this and resets it to null after handling.
   */
  navigateToPayrollId = signal<string | null>(null);
}
