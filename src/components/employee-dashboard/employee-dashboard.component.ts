import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { DatabaseService } from '../../services/database.service';
import { DashboardHeaderComponent } from '../shared/dashboard-header/dashboard-header.component';
import { EmployeePayrollReport } from '../../models/payroll.model';
import { SettingsService } from '../../services/settings.service';

// To satisfy the TypeScript compiler for jsPDF and autoTable
declare var jspdf: any;

@Component({
  selector: 'app-employee-dashboard',
  standalone: true,
  templateUrl: './employee-dashboard.component.html',
  imports: [CommonModule, DashboardHeaderComponent, CurrencyPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDashboardComponent {
  private authService = inject(AuthService);
  private dataService = inject(DatabaseService);
  private settingsService = inject(SettingsService);
  private datePipe = inject(DatePipe);
  private currencyPipe = inject(CurrencyPipe);
  
  logo = computed(() => this.settingsService.settings().logoUrl);
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

  // For current, unprocessed work
  unprocessedJobs = computed(() => {
    const user = this.currentUser();
    if (!user) return [];
    return this.dataService.jobs().filter(j => j.techId === user.techId);
  });

  private rateMap = computed(() => {
    const user = this.currentUser();
    if (!user || !user.rateCategoryId) return new Map<string, number>();
    const category = this.dataService.rateCategories().find(rc => rc.id === user.rateCategoryId);
    if (!category) return new Map<string, number>();
    return new Map(category.rates.map(r => [r.taskCode.toLowerCase().trim(), r.rate]));
  });

  unprocessedJobsWithEarnings = computed(() => {
    const map = this.rateMap();
    return this.unprocessedJobs().map(job => {
      const rate = map.get(job.taskCode.toLowerCase().trim()) ?? 0;
      const earning = rate * job.quantity;
      return { ...job, rate, earning };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  unprocessedSummary = computed(() => {
    const jobs = this.unprocessedJobsWithEarnings();
    return {
      totalJobs: jobs.length,
      totalRevenue: jobs.reduce((sum, j) => sum + j.revenue, 0),
      estimatedEarnings: jobs.reduce((sum, j) => sum + j.earning, 0)
    };
  });

  selectReport(id: string | null): void {
    this.selectedReportId.set(id);
  }

  logout(): void {
    this.authService.logout();
  }

  downloadReportAsPDF(report: EmployeePayrollReport) {
    const { jsPDF } = jspdf;
    const doc = new jsPDF();
    const user = this.currentUser();
    if (!user) return;
    
    const data = report.reportData;
    const baseEarnings = data.totalEarnings - data.adjustments.reduce((s, a) => s + a.amount, 0);
    
    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Pay Statement', 105, 22, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Pay Period: ${this.datePipe.transform(report.startDate, 'mediumDate')} - ${this.datePipe.transform(report.endDate, 'mediumDate')}`, 105, 30, { align: 'center' });

    // Employee Info
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Employee Information', 14, 45);
    (doc as any).autoTable({
        startY: 48,
        body: [
            ['Name', user.name, 'Tech ID', user.techId],
            ['Email', user.email, 'Phone', user.phone],
        ],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 1.5 },
        columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } }
    });

    // Earnings Summary
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Payroll Summary', 14, finalY);
    (doc as any).autoTable({
        startY: finalY + 3,
        body: [
            ['Base Earnings from Jobs', this.currencyPipe.transform(baseEarnings)],
            ['Total Adjustments', this.currencyPipe.transform(data.adjustments.reduce((s, a) => s + a.amount, 0))],
        ],
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 2, halign: 'right' },
        headStyles: { fillColor: [22, 160, 133] },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
        didDrawPage: (data: any) => {
            // Total Row
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.text('Final Payout', data.settings.margin.left, data.cursor.y + 10);
            doc.text(this.currencyPipe.transform(report.reportData.totalEarnings) || '$0.00', data.table.width, data.cursor.y + 10, { align: 'right' });
        }
    });

    let tableY = (doc as any).lastAutoTable.finalY + 20;

    // Adjustments
    if (data.adjustments.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Adjustments Breakdown', 14, tableY);
        (doc as any).autoTable({
            startY: tableY + 3,
            head: [['Date', 'Type', 'Description', 'Amount']],
            body: data.adjustments.map(adj => [
                this.datePipe.transform(adj.date, 'shortDate'), 
                adj.type, 
                adj.description, 
                this.currencyPipe.transform(adj.amount)
            ]),
            theme: 'striped',
            headStyles: { fillColor: [44, 62, 80] },
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: { 3: { halign: 'right' } },
        });
        tableY = (doc as any).lastAutoTable.finalY + 10;
    }

    // Jobs
    if (data.processedJobs.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Jobs Breakdown', 14, tableY);
        (doc as any).autoTable({
            startY: tableY + 3,
            head: [['Date', 'Task Code', 'Qty', 'Revenue', 'Rate', 'Earning']],
            body: data.processedJobs.map(job => [
                this.datePipe.transform(job.date, 'shortDate'),
                job.taskCode,
                job.quantity,
                this.currencyPipe.transform(job.revenue),
                this.currencyPipe.transform(job.rateApplied),
                this.currencyPipe.transform(job.earning),
            ]),
            theme: 'striped',
            headStyles: { fillColor: [44, 62, 80] },
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
        });
    }

    doc.save(`Pay-Statement-${report.startDate}-to-${report.endDate}.pdf`);
  }
}
