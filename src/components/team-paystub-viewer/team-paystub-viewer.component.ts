import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { SettingsService, AppSettings } from '../../services/settings.service';
import { AuthService } from '../../services/auth.service';
import { EmployeePayrollReport, User, SubAdminSettings } from '../../models/payroll.model';
import { PaystubService } from '../../services/paystub.service';

// To satisfy the TypeScript compiler for jsPDF and autoTable
declare var jspdf: any;

@Component({
  selector: 'app-team-paystub-viewer',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe],
  templateUrl: './team-paystub-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamPaystubViewerComponent {
  private dataService = inject(DatabaseService);
  private settingsService = inject(SettingsService);
  private authService = inject(AuthService);
  private paystubService = inject(PaystubService);
  private datePipe: DatePipe;
  private currencyPipe: CurrencyPipe;

  globalSettings = this.settingsService.settings;
  currentUser = this.authService.currentUser;
  
  teamMemberIds = computed(() => {
    const currentUser = this.currentUser();
    if (!currentUser) return new Set<string>();
    const teamIds = this.dataService.users()
        .filter(u => u.assignedTo === currentUser.id)
        .map(u => u.id);
    
    // Add current user's ID to the set
    return new Set([currentUser.id, ...teamIds]);
  });

  allEmployeeReports = this.dataService.employeeReports;
  allUsersMap = computed(() => new Map(this.dataService.users().map(u => [u.id, u])));
  
  subAdminSettings = computed(() => {
    const userId = this.currentUser()?.id;
    if (!userId) return null;
    return this.dataService.subAdminSettings().find(s => s.subAdminId === userId) ?? null;
  });

  displaySettings = computed(() => {
    const global = this.globalSettings();
    const subAdmin = this.subAdminSettings();
    if (!subAdmin) return global;
    
    // Merge, giving sub-admin's settings precedence
    return {
      ...global,
      logoUrl: subAdmin.logoUrl || global.logoUrl,
      companyName: subAdmin.companyName || global.companyName,
      companyAddress1: subAdmin.companyAddress1 || global.companyAddress1,
      companyAddress2: subAdmin.companyAddress2 || global.companyAddress2,
      companyEmail: subAdmin.companyEmail || global.companyEmail,
      companyPhone: subAdmin.companyPhone || global.companyPhone,
    };
  });
  
  availablePayrolls = computed(() => {
    const teamIds = this.teamMemberIds();
    const payrollsMap = new Map<string, { id: string, startDate: string, endDate: string }>();

    this.allEmployeeReports().forEach(report => {
      if (teamIds.has(report.userId)) {
        if (!payrollsMap.has(report.payrollId)) {
          payrollsMap.set(report.payrollId, {
            id: report.payrollId,
            startDate: report.startDate,
            endDate: report.endDate,
          });
        }
      }
    });

    return Array.from(payrollsMap.values())
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
  });

  selectedPayrollId = signal<string | null>(null);
  selectedUserId = signal<string | null>(null);

  selectedPayroll = computed(() => {
    const id = this.selectedPayrollId();
    if (!id) return this.availablePayrolls()[0] ?? null;
    return this.availablePayrolls().find(p => p.id === id) ?? null;
  });

  employeesInPayroll = computed(() => {
    const payroll = this.selectedPayroll();
    const userMap = this.allUsersMap();
    const teamIds = this.teamMemberIds();
    if (!payroll) return [];
    
    const userIdsInPayroll = new Set(
      this.allEmployeeReports()
        .filter(r => r.payrollId === payroll.id && teamIds.has(r.userId))
        .map(r => r.userId)
    );

    return Array.from(userIdsInPayroll)
      .map(id => userMap.get(id))
      .filter((user): user is User => !!user)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  selectedReport = computed(() => {
    const payrollId = this.selectedPayroll()?.id;
    const userId = this.selectedUserId();
    if (!payrollId || !userId) return null;
    return this.dataService.employeeReports().find(r => r.payrollId === payrollId && r.userId === userId) ?? null;
  });

  paystubData = computed(() => {
    const report = this.selectedReport();
    const user = this.selectedUserId() ? this.allUsersMap().get(this.selectedUserId()!) : null;

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
    const netPay = data.totalEarnings;

    return {
      report,
      data,
      user,
      ytdEarnings,
      jobEarnings,
      totalBonus,
      totalChargeback,
      totalLoan,
      itemizedDeductions,
      grossEarnings,
      totalDeductions,
      netPay,
      displaySettings: this.displaySettings(),
    };
  });
  
  maskedTin = computed(() => {
    const user = this.paystubData()?.user;
    if (!user?.tin || user.tin.length < 4) return 'N/A';
    return `***-**-${user.tin.slice(-4)}`;
  });

  constructor() {
    this.datePipe = inject(DatePipe);
    this.currencyPipe = inject(CurrencyPipe);
  }

  selectPayroll(event: Event) {
    const id = (event.target as HTMLSelectElement).value;
    this.selectedPayrollId.set(id);
    this.selectedUserId.set(null); // Reset employee selection
  }

  selectUser(userId: string) {
    this.selectedUserId.set(userId);
  }
  
  downloadPaystubAsPDF() {
    const stub = this.paystubData();
    if (!stub) return;
    
    const { report, user, displaySettings, ytdEarnings } = stub;

    this.paystubService.generatePaystubPDF(
      report,
      user,
      displaySettings,
      ytdEarnings
    );
  }
}
