import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { DatabaseService } from '../../services/database.service';
import { SettingsService } from '../../services/settings.service';
import { DashboardHeaderComponent } from '../shared/dashboard-header/dashboard-header.component';
import { SidebarComponent } from '../shared/sidebar/sidebar.component';
import { PerformanceViewerComponent } from '../performance-viewer/performance-viewer.component';
import { User } from '../../models/payroll.model';
import { PaystubService } from '../../services/paystub.service';
import { TaxFormsComponent } from '../tax-forms/tax-forms.component';

// To satisfy the TypeScript compiler for jsPDF and autoTable
declare var jspdf: any;

type SupervisorTab = 'myPaystubs' | 'myPerformance' | 'teamPerformance' | '1099-forms';

@Component({
  selector: 'app-supervisor-dashboard',
  standalone: true,
  templateUrl: './supervisor-dashboard.component.html',
  imports: [
    CommonModule,
    SidebarComponent,
    DashboardHeaderComponent,
    PerformanceViewerComponent,
    DatePipe,
    CurrencyPipe,
    TaxFormsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupervisorDashboardComponent {
  private authService = inject(AuthService);
  private dataService = inject(DatabaseService);
  private settingsService = inject(SettingsService);
  private paystubService = inject(PaystubService);
  private datePipe: DatePipe;
  private currencyPipe: CurrencyPipe;

  currentUser = this.authService.currentUser;
  companySettings = this.settingsService.settings;
  activeTab = signal<SupervisorTab>('myPaystubs');
  
  tabs: { id: SupervisorTab; name: string; icon: string }[] = [
    { id: 'myPaystubs', name: 'My Paystubs', icon: 'paystubs' },
    { id: 'myPerformance', name: 'My Performance', icon: 'performance' },
    { id: 'teamPerformance', name: 'Team Performance', icon: 'users' },
    { id: '1099-forms', name: '1099 Forms', icon: 'tax' },
  ];

  // ===== MY PAYSTUB LOGIC (from employee dashboard) =====
  payrollHistory = computed(() => {
    const user = this.currentUser();
    if (!user) return [];
    return this.dataService.employeeReports()
      .filter(report => report.userId === user.id && report.status === 'finalized')
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
  });

  selectedReportId = signal<string | null>(null);

  selectedReport = computed(() => {
    const history = this.payrollHistory();
    const id = this.selectedReportId();
    if (!id) {
      return history.length > 0 ? history[0] : null;
    }
    return history.find(r => r.id === id) ?? null;
  });

  paystubData = computed(() => {
    const report = this.selectedReport();
    const user = this.currentUser();
    if (!report || !user) return null;

    const data = report.reportData;
    const ytdEarnings = this.dataService.employeeReports()
      .filter(r => r.userId === user.id && new Date(r.endDate) <= new Date(report.endDate))
      .reduce((sum, r) => sum + r.reportData.totalEarnings, 0);

    const jobEarnings = data.processedJobs.reduce((sum, job) => sum + job.earning, 0);
    
    const adjustments = data.adjustments;
    const totalBonus = adjustments.filter(a => a.type === 'Bonus').reduce((sum, a) => sum + a.amount, 0);
    const totalChargeback = adjustments.filter(a => a.type === 'Chargeback').reduce((sum, a) => sum + a.amount, 0);
    const totalLoan = adjustments.filter(a => a.type === 'Loan').reduce((sum, a) => sum + a.amount, 0);
    const itemizedDeductions = adjustments.filter(a => ['Rent', 'Fee', 'RepeatTC'].includes(a.type));
    
    const grossEarnings = jobEarnings + totalBonus;
    const itemizedDeductionsTotal = itemizedDeductions.reduce((sum, a) => sum + a.amount, 0);
    const totalDeductions = totalChargeback + totalLoan + itemizedDeductionsTotal;
    const netPay = data.totalEarnings; // This is the final calculated amount

    return {
      report,
      data,
      ytdEarnings,
      jobEarnings,
      totalBonus,
      totalChargeback,
      totalLoan,
      itemizedDeductions,
      grossEarnings,
      totalDeductions,
      netPay
    };
  });

  // ===== TEAM PERFORMANCE LOGIC =====
  teamMembers = computed(() => {
    const user = this.currentUser();
    if (!user) return [];
    return this.dataService.users().filter(u => u.assignedTo === user.id);
  });
  
  teamMembersWithSelf = computed<User[]>(() => {
    const user = this.currentUser();
    if (!user) return [];
    // Ensure no duplicates and sort
    const teamMap = new Map(this.teamMembers().map(u => [u.id, u]));
    teamMap.set(user.id, user);
    return Array.from(teamMap.values()).sort((a: User, b: User) => a.name.localeCompare(b.name));
  });

  constructor() {
    this.datePipe = inject(DatePipe);
    this.currencyPipe = inject(CurrencyPipe);
  }

  selectTab(tab: SupervisorTab): void {
    this.activeTab.set(tab);
  }

  logout(): void {
    this.authService.logout();
  }
  
  selectReport(id: string | null): void {
    this.selectedReportId.set(id);
  }

  downloadPaystubAsPDF() {
    const stub = this.paystubData();
    const user = this.currentUser();
    if (!stub || !user) return;
    
    this.paystubService.generatePaystubPDF(
      stub.report,
      user,
      this.companySettings(),
      stub.ytdEarnings
    );
  }
}