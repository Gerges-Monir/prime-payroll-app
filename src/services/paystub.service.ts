import { Injectable, inject } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { EmployeePayrollReport, User } from '../models/payroll.model';
import { AppSettings } from './settings.service';

// To satisfy the TypeScript compiler for jsPDF and autoTable
declare var jspdf: any;

@Injectable({
  providedIn: 'root',
})
export class PaystubService {
  private datePipe: DatePipe;
  private currencyPipe: CurrencyPipe;

  constructor() {
    this.datePipe = inject(DatePipe);
    this.currencyPipe = inject(CurrencyPipe);
  }

  public generatePaystubPDF(
    report: EmployeePayrollReport,
    user: User,
    settings: AppSettings,
    ytdEarnings: number
  ): void {
    const data = report.reportData;
    const jobEarnings = data.processedJobs.reduce((sum, job) => sum + job.earning, 0);
    const adjustments = data.adjustments;
    const totalBonus = adjustments.filter(a => a.type === 'Bonus').reduce((sum, a) => sum + a.amount, 0);
    const totalChargeback = adjustments.filter(a => a.type === 'Chargeback').reduce((sum, a) => sum + a.amount, 0);
    const totalLoan = adjustments.filter(a => a.type === 'Loan').reduce((sum, a) => sum + a.amount, 0);
    const itemizedDeductions = adjustments.filter(a => ['Rent', 'Fee', 'RepeatTC'].includes(a.type));
    const grossEarnings = jobEarnings + totalBonus;
    const itemizedDeductionsTotal = itemizedDeductions.reduce((sum, a) => sum + a.amount, 0);
    const totalDeductions = totalChargeback + totalLoan + itemizedDeductionsTotal;

    const { jsPDF } = jspdf;
    const doc = new jsPDF();
    
    let tableY = 15;

    // Header with Logo
    const logoDataUrl = settings.logoUrl;
    let logoFormat = 'SVG'; // Default
    if (logoDataUrl.startsWith('data:image/jpeg')) {
      logoFormat = 'JPEG';
    } else if (logoDataUrl.startsWith('data:image/png')) {
      logoFormat = 'PNG';
    }
    doc.addImage(logoDataUrl, logoFormat, 14, tableY, 50, 12.5);
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Earning Statement', 200, tableY + 5, { align: 'right' });
    
    tableY += 10;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(settings.companyName ?? '', 14, tableY + 10);
    doc.text(settings.companyAddress1 ?? '', 14, tableY + 15);
    doc.text(settings.companyAddress2 ?? '', 14, tableY + 20);

    doc.text(`Payment ID: ${report.paymentId ?? ''}`, 200, tableY + 10, { align: 'right' });

    tableY += 25;

    const maskedTin = user.tin && user.tin.length >= 4 ? `***-**-${user.tin.slice(-4)}` : 'N/A';

    // Employee Info & Pay Period
    const employeeInfoBody: any[] = [
        [{ content: 'Employee Info', styles: { fontStyle: 'bold' } }, '', { content: 'Pay Schedule', styles: { fontStyle: 'bold' } }, ''],
        ['Name', String(user.name ?? ''), 'Pay Period', `${this.datePipe.transform(report.startDate, 'mediumDate') ?? ''} - ${this.datePipe.transform(report.endDate, 'mediumDate') ?? ''}`],
        ['Email', String(user.email ?? ''), 'Pay Date', String(this.datePipe.transform(new Date(report.publishedDate), 'mediumDate') ?? '')],
        ['SSN', maskedTin, '', ''],
    ];
    (doc as any).autoTable({
        startY: tableY,
        body: employeeInfoBody,
        theme: 'striped',
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } }
    });
    tableY = (doc as any).lastAutoTable.finalY + 8;

    // Summary Table
    const summaryBody: any[][] = [
        ['Base Earnings', String(this.currencyPipe.transform(jobEarnings) ?? '')],
    ];
    if (totalBonus > 0) summaryBody.push(['Bonus', String(this.currencyPipe.transform(totalBonus) ?? '')]);
    summaryBody.push([{ content: 'Gross Earnings', styles: { fontStyle: 'bold' } }, { content: String(this.currencyPipe.transform(grossEarnings) ?? ''), styles: { fontStyle: 'bold' } }]);
    if (totalChargeback < 0) summaryBody.push(['Chargeback', String(this.currencyPipe.transform(totalChargeback) ?? '')]);
    if (totalLoan < 0) summaryBody.push(['Loan', String(this.currencyPipe.transform(totalLoan) ?? '')]);
    itemizedDeductions.forEach(d => summaryBody.push([String(d.description ?? ''), String(this.currencyPipe.transform(d.amount) ?? '')]));
    if (totalDeductions < 0) summaryBody.push([{ content: 'Total Deductions', styles: { fontStyle: 'bold' } }, { content: String(this.currencyPipe.transform(totalDeductions) ?? ''), styles: { fontStyle: 'bold' } }]);

    (doc as any).autoTable({
        startY: tableY,
        head: [['Summary', 'Amount']],
        body: summaryBody,
        theme: 'grid',
        headStyles: { fillColor: [22, 110, 180] },
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 1: { halign: 'right' } }
    });
    tableY = (doc as any).lastAutoTable.finalY;

     // Final Totals
    (doc as any).autoTable({
        startY: tableY,
        body: [
            ['Net Payment', String(this.currencyPipe.transform(data.totalEarnings) ?? '')],
            ['YTD Earning', String(this.currencyPipe.transform(ytdEarnings) ?? '')],
        ],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 2, halign: 'right' },
        columnStyles: { 0: { fontStyle: 'bold', halign: 'right' } },
    });
    tableY = (doc as any).lastAutoTable.finalY + 10;
    
    // Job Details
    const pageHeight = doc.internal.pageSize.height;
    if (tableY > pageHeight - 50 && data.processedJobs.length > 0) {
        doc.addPage();
        tableY = 20;
    }
    if(data.processedJobs.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Job Details', 14, tableY);
        (doc as any).autoTable({
            startY: tableY + 3,
            head: [['Date', 'Work Order', 'Task', 'Qty', 'Earning']],
            body: data.processedJobs.map(job => [
                String(this.datePipe.transform(job.date, 'shortDate') ?? ''),
                String(job.workOrder ?? ''),
                String(job.taskCode ?? ''),
                String(job.quantity ?? 0),
                String(this.currencyPipe.transform(job.earning) ?? '')
            ]),
            theme: 'striped',
            headStyles: { fillColor: [44, 62, 80] },
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } }
        });
    }

    doc.save(`Paystub-${user.name.replace(/\s/g, '_')}-${report.startDate}.pdf`);
  }
}
