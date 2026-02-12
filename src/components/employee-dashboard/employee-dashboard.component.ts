import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { DatabaseService } from '../../services/database.service';
import { DashboardHeaderComponent } from '../shared/dashboard-header/dashboard-header.component';
import { EmployeePayrollReport, ProcessedJob, Adjustment } from '../../models/payroll.model';
import { SettingsService } from '../../services/settings.service';
import { PerformanceViewerComponent } from '../performance-viewer/performance-viewer.component';
import { ChargebackHistoryComponent } from '../chargeback-history/chargeback-history.component';
import { PaystubService } from '../../services/paystub.service';
import { QcUploaderComponent } from '../qc-uploader/qc-uploader.component';
import { TaxFormsComponent } from '../tax-forms/tax-forms.component';

// To satisfy the TypeScript compiler for jsPDF and autoTable
declare var jspdf: any;
declare var XLSX: any;

type EmployeeView = 'paystub' | 'performance' | 'chargebacks' | 'qcUploads' | '1099-forms';

@Component({
  selector: 'app-employee-dashboard',
  standalone: true,
  templateUrl: './employee-dashboard.component.html',
  imports: [CommonModule, DashboardHeaderComponent, PerformanceViewerComponent, ChargebackHistoryComponent, QcUploaderComponent, CurrencyPipe, DatePipe, TaxFormsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDashboardComponent {
  private authService = inject(AuthService);
  private dataService = inject(DatabaseService);
  private settingsService = inject(SettingsService);
  private paystubService = inject(PaystubService);
  private datePipe: DatePipe;
  private currencyPipe: CurrencyPipe;
  
  companySettings = this.settingsService.settings;
  currentUser = this.authService.currentUser;
  activeView = signal<EmployeeView>('paystub');
  
  maskedTin = computed(() => {
    const tin = this.currentUser()?.tin;
    if (!tin || tin.length < 4) return 'N/A';
    return `***-**-${tin.slice(-4)}`;
  });

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

  constructor() {
    this.datePipe = inject(DatePipe);
    this.currencyPipe = inject(CurrencyPipe);
  }

  selectReport(id: string | null): void {
    this.selectedReportId.set(id);
  }

  logout(): void {
    this.authService.logout();
  }

  downloadExcelReport() {
    const stub = this.paystubData();
    const user = this.currentUser();
    if (!stub || !user) return;

    const { report, data } = stub;

    const header = [
        "Technician ID", "Technician Name", "Work Order #", "Task Code", 
        "Cost Per", "Qty", "Cost", "Meter/ladder rent & software fee", 
        "Repeat TC", "Loan", "Bonus / Training", "week salary"
    ];
    
    const lineItems: any[] = [];

    // Add jobs as line items
    for (const job of data.processedJobs) {
        lineItems.push({
            "Technician ID": user.techId,
            "Technician Name": user.name,
            "Work Order #": job.workOrder,
            "Task Code": job.taskCode,
            "Cost Per": job.rateApplied,
            "Qty": job.quantity,
            "Cost": job.earning,
        });
    }

    // Add adjustments as line items
    for (const adj of data.adjustments) {
        const item: any = {
            "Technician ID": user.techId,
            "Technician Name": user.name,
            "Work Order #": adj.description, // Use description for context
        };
        switch(adj.type) {
            case 'Fee': item['Meter/ladder rent & software fee'] = adj.amount; break;
            case 'RepeatTC': item['Repeat TC'] = adj.amount; break;
            case 'Loan': item['Loan'] = adj.amount; break;
            case 'Bonus': item['Bonus / Training'] = adj.amount; break;
            // Other types like chargeback can be added here if needed
            default: 
                item['Task Code'] = adj.type;
                item['Cost'] = adj.amount; // Put generic adjustments in 'Cost'
                break;
        }
        lineItems.push(item);
    }
    
    // Add total row
    if (lineItems.length > 0) {
        lineItems[lineItems.length -1]['week salary'] = stub.netPay;
    }

    const worksheet = XLSX.utils.json_to_sheet(lineItems, { header });

    // Formatting
    worksheet['!cols'] = [
        { wch: 15 }, { wch: 25 }, { wch: 30 }, { wch: 20 }, { wch: 10 }, 
        { wch: 8 }, { wch: 10 }, { wch: 30 }, { wch: 15 }, { wch: 10 },
        { wch: 20 }, { wch: 15 }
    ];
    
    const moneyFormat = { numFmt: "$#,##0.00" };
    const integerFormat = { numFmt: "0" };

    lineItems.forEach((_, rowIndex) => {
        const r = rowIndex + 2; // 1-based index, plus header row
        const colMap = { E: 'Cost Per', G: 'Cost', H: 'Meter/ladder rent & software fee', I: 'Repeat TC', J: 'Loan', K: 'Bonus / Training', L: 'week salary' };
        Object.entries(colMap).forEach(([col, key]) => {
            if (lineItems[rowIndex][key] !== undefined) {
                worksheet[`${col}${r}`].z = moneyFormat.numFmt;
            }
        });
        if(worksheet[`F${r}`]) worksheet[`F${r}`].z = integerFormat.numFmt;
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Paystub Details');
    XLSX.writeFile(workbook, `Paystub_${report.startDate}_${report.endDate}.xlsx`);
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
