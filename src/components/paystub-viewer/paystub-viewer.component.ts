import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { SettingsService } from '../../services/settings.service';
import { NotificationService } from '../../services/notification.service';
import { EmployeePayrollReport, User } from '../../models/payroll.model';
import { SmtpService } from '../../services/smtp.service';
import { PaystubService } from '../../services/paystub.service';

@Component({
  selector: 'app-paystub-viewer',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe],
  templateUrl: './paystub-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaystubViewerComponent {
  private dataService = inject(DatabaseService);
  private settingsService = inject(SettingsService);
  private notificationService = inject(NotificationService);
  private smtpService = inject(SmtpService);
  private paystubService = inject(PaystubService);

  companySettings = this.settingsService.settings;
  
  publishedPayrolls = computed(() => this.dataService.publishedPayrolls().sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()));
  allUsersMap = computed(() => new Map(this.dataService.users().map(u => [u.id, u])));
  
  selectedPayrollId = signal<string | null>(null);
  selectedUserId = signal<string | null>(null);

  selectedPayroll = computed(() => {
    const id = this.selectedPayrollId();
    if (!id) return this.publishedPayrolls()[0] ?? null;
    return this.publishedPayrolls().find(p => p.id === id) ?? null;
  });

  employeesInPayroll = computed(() => {
    const payroll = this.selectedPayroll();
    const userMap = this.allUsersMap();
    if (!payroll) return [];
    return payroll.reportData
      .map(techReport => userMap.get(techReport.id))
      .filter((user): user is User => !!user)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  selectedReport = computed(() => {
    const payroll = this.selectedPayroll();
    const userId = this.selectedUserId();
    if (!payroll || !userId) return null;
    
    // Find the actual EmployeePayrollReport for this user and payroll period.
    // This ensures we get the correct paymentId.
    return this.dataService.employeeReports().find(r => 
        r.startDate === payroll.startDate &&
        r.endDate === payroll.endDate &&
        r.userId === userId
    ) ?? null;
  });
  
  selectedUserHasValidEmail = computed(() => {
    const user = this.paystubData()?.user;
    if (!user) return false;
    if (!user.email || user.email.trim() === '') {
      return false;
    }
    // Check for the default placeholder email format
    if (user.email.startsWith('tech') && user.email.endsWith('@primecommunication.com')) {
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(user.email);
  });
  
  private parseDateAsUTC(dateString: string): Date {
      if (!dateString) { return new Date(NaN); }
      const datePart = dateString.split('T')[0];
      const parts = datePart.split('-').map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        const [year, month, day] = parts;
        const d = new Date(Date.UTC(year, month - 1, day));
        if (d && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) {
            return d;
        }
      }
      return new Date(NaN);
  }

  private getWeekOfYear(date: Date): number {
    if (!date || isNaN(date.getTime())) { return 1; }
    const targetDate = this.parseDateAsUTC(date.toISOString().split('T')[0]);
    if (isNaN(targetDate.getTime())) { return 1; }
    const startOfYear = new Date(Date.UTC(targetDate.getUTCFullYear(), 0, 1));
    const diff = targetDate.getTime() - startOfYear.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);
    return Math.ceil((dayOfYear + 1) / 7);
  }

  paystubData = computed(() => {
    const originalReport = this.selectedReport();
    const user = this.selectedUserId() ? this.allUsersMap().get(this.selectedUserId()!) : null;

    if (!originalReport || !user) return null;
    
    // Backward compatibility fix: If the paymentId is a large number (timestamp),
    // recalculate it on the fly. Otherwise, use the stored one.
    let displayPaymentId: number;
    if (originalReport.paymentId > 1000) { // Heuristic to detect old timestamps
        const endDateObj = this.parseDateAsUTC(originalReport.endDate);
        displayPaymentId = this.getWeekOfYear(endDateObj);
    } else {
        displayPaymentId = originalReport.paymentId;
    }
    
    const report = { ...originalReport, paymentId: displayPaymentId };

    const data = report.reportData;
    // YTD for admin view should come from main payroll history
     const ytdEarnings = this.dataService.publishedPayrolls()
      .filter(p => new Date(p.endDate) <= new Date(report.endDate))
      .flatMap(p => p.reportData)
      .filter(r => r.id === user.id)
      .reduce((sum, r) => sum + r.totalEarnings, 0);

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
      netPay
    };
  });
  
  maskedTin = computed(() => {
    const user = this.paystubData()?.user;
    if (!user?.tin || user.tin.length < 4) return 'N/A';
    return `***-**-${user.tin.slice(-4)}`;
  });

  selectPayroll(event: Event) {
    const id = (event.target as HTMLSelectElement).value;
    this.selectedPayrollId.set(id);
    this.selectedUserId.set(null); // Reset employee selection
  }

  selectUser(userId: string) {
    this.selectedUserId.set(userId);
  }

  emailPaystub() {
    const data = this.paystubData();
    if (!data) {
      this.notificationService.showError('No paystub selected to email.');
      return;
    }
    this.smtpService.sendPaystub(data.user, data);
  }

  downloadPaystubAsPDF() {
    const data = this.paystubData();
    if (!data) {
      this.notificationService.showError('No paystub data available to download.');
      return;
    }

    // The paystub service needs the report, user, settings, and YTD
    this.paystubService.generatePaystubPDF(
      data.report,
      data.user,
      this.companySettings(),
      data.ytdEarnings
    );
  }
}
