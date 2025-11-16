import { Component, ChangeDetectionStrategy, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { MockDataService } from '../../services/mock-data.service';
import { DashboardHeaderComponent } from '../shared/dashboard-header/dashboard-header.component';
import { EmployeePayrollReport, Adjustment } from '../../models/payroll.model';

@Component({
  selector: 'app-employee-dashboard',
  standalone: true,
  templateUrl: './employee-dashboard.component.html',
  imports: [CommonModule, DashboardHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDashboardComponent implements OnInit {
  private authService = inject(AuthService);
  private dataService = inject(MockDataService);

  currentUser = this.authService.currentUser;
  
  payrollHistory = computed(() => {
    const user = this.currentUser();
    if (!user) return [];
    return this.dataService.employeeReports()
      .filter(report => report.userId === user.id && report.status === 'finalized')
      .sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());
  });

  selectedReportId = signal<string | null>(null);

  selectedReport = computed(() => {
    const id = this.selectedReportId();
    if (!id) return null;
    return this.payrollHistory().find(r => r.id === id) ?? null;
  });

  baseEarnings = computed(() => {
    const report = this.selectedReport();
    if (!report) return 0;
    const adjTotal = report.reportData.adjustments.reduce((sum, adj) => sum + adj.amount, 0);
    return report.reportData.totalEarnings - adjTotal;
  });

  ngOnInit(): void {
    // Select the most recent report by default
    const latestReport = this.payrollHistory()[0];
    if (latestReport) {
      this.selectedReportId.set(latestReport.id);
    }
  }

  selectReport(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedReportId.set(select.value);
  }

  logout(): void {
    this.authService.logout();
  }
}