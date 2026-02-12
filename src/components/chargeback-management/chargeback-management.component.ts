import { Component, ChangeDetectionStrategy, inject, computed, signal, effect } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { NotificationService } from '../../services/notification.service';
import { User, ChargebackReport, ChargebackSummaryItem } from '../../models/payroll.model';

declare var XLSX: any;

interface MonthOption {
  id: string; // YYYY-MM
  display: string;
}

interface UserReportData {
  user: User;
  report: ChargebackReport | undefined;
  status: 'idle' | 'uploading' | 'success' | 'error';
  message: string;
}

@Component({
  selector: 'app-chargeback-management',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe],
  templateUrl: './chargeback-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChargebackManagementComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);

  // Users who can receive chargeback reports (sub-admins or unassigned employees)
  targetUsers = computed(() => 
    this.dataService.users().filter(u => u.role === 'sub-admin' || (u.role === 'employee' && !u.assignedTo))
  );

  availableMonths = computed<MonthOption[]>(() => {
    const allJobs = [
        ...this.dataService.jobs(), 
        ...this.dataService.publishedPayrolls().flatMap(p => p.reportData.flatMap(rd => rd.processedJobs))
    ];
    const monthIdentifiers = new Set<string>();
    allJobs.forEach(item => {
      const itemDate = this.dataService.parseDateAsUTC(item.date);
      if (!isNaN(itemDate.getTime())) {
        monthIdentifiers.add(itemDate.toISOString().substring(0, 7)); // YYYY-MM
      }
    });

    return Array.from(monthIdentifiers).map(monthId => {
      const [year, month] = monthId.split('-');
      const date = new Date(Number(year), Number(month) - 1, 1);
      return { 
        id: monthId, 
        display: date.toLocaleString('en-US', { month: 'long', year: 'numeric' })
      };
    }).sort((a, b) => b.id.localeCompare(a.id));
  });

  selectedMonth = signal<string>('');
  showFormatHelp = signal(false);
  
  userReportData = computed<UserReportData[]>(() => {
    const month = this.selectedMonth();
    if (!month) return [];
    
    const chargebackReports = this.dataService.chargebackReports();
    return this.targetUsers().map(user => {
        const reportId = `${month}_${user.id}`;
        const existingReport = chargebackReports.find(r => r.id === reportId);
        return {
          user,
          report: existingReport,
          status: 'idle',
          message: '',
        };
    });
  });

  hasDraftsForMonth = computed(() => {
    return this.userReportData().some(data => data.report && data.report.status === 'draft');
  });

  constructor() {
    effect(() => {
        const months = this.availableMonths();
        if (months.length > 0 && !this.selectedMonth()) {
            this.selectedMonth.set(months[0].id);
        }
    });
  }

  onFileSelected(event: Event, userData: UserReportData): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    userData.status = 'uploading';
    userData.message = 'Processing file...';

    const fileReader = new FileReader();
    fileReader.onload = async (e: any) => {
        try {
            const arrayBuffer = e.target.result;
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

            const { summary, total } = this.parseSummarySheet(jsonData);
            
            // Read file again as dataURL for storage
            const dataUrlReader = new FileReader();
            dataUrlReader.onload = async (e2: any) => {
                const reportData = {
                    userId: userData.user.id,
                    monthIdentifier: this.selectedMonth(),
                    fileName: file.name,
                    fileDataUrl: e2.target.result as string,
                    summaryData: summary,
                    totalCharge: total,
                };

                await this.dataService.addOrUpdateChargebackReport(reportData);
                userData.status = 'success';
                userData.message = `Uploaded and parsed successfully. Total: ${this.formatCurrency(total)}`;
                this.notificationService.showSuccess(`Report for ${userData.user.name} saved as draft.`);
            };
            dataUrlReader.readAsDataURL(file);

        } catch(err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred.';
            userData.status = 'error';
            userData.message = message;
        }
    };
    fileReader.readAsArrayBuffer(file);
    input.value = ''; // Reset input
  }
  
  private parseSummarySheet(data: any[]): { summary: ChargebackSummaryItem[], total: number } {
    if (!data || data.length === 0) throw new Error('Excel sheet is empty.');

    const headers = Object.keys(data[0] || {});
    const companyHeader = headers.find(h => h.toLowerCase().includes('company'));
    const chargebackHeader = headers.find(h => h.toLowerCase().includes('chargeback'));
    const amountHeader = headers.find(h => h.toLowerCase().includes('amount'));

    if (!chargebackHeader || !amountHeader) {
        throw new Error("Sheet must contain 'Chargeback' and 'Amount' columns.");
    }

    let totalCharge = 0;
    const summaryData: ChargebackSummaryItem[] = [];

    for (const row of data) {
        const chargebackValue = String(row[chargebackHeader] || '').trim();
        const amountValue = row[amountHeader];
        
        if (chargebackValue.toLowerCase() === 'total charge') {
            totalCharge = parseFloat(String(amountValue).replace(/[^0-9.-]+/g,"")) || 0;
        } else if (chargebackValue) { // Ensure it's not an empty row
            summaryData.push({
                company: companyHeader ? String(row[companyHeader] || '') : 'N/A',
                chargeback: chargebackValue,
                amount: parseFloat(String(amountValue).replace(/[^0-9.-]+/g,"")) || 0,
            });
        }
    }
    
    // Fallback if total row wasn't found
    if(totalCharge === 0 && summaryData.length > 0) {
        totalCharge = summaryData.reduce((sum, item) => sum + item.amount, 0);
    }

    return { summary: summaryData, total: totalCharge };
  }

  async publishAllForMonth(): Promise<void> {
    const month = this.selectedMonth();
    if (!month) return;
    try {
        await this.dataService.publishChargebackReportsForMonth(month);
        this.notificationService.showSuccess(`All draft chargeback reports for ${month} have been published.`);
    } catch(e) {
        this.notificationService.showError('Failed to publish reports.');
    }
  }

  async deleteReport(userData: UserReportData): Promise<void> {
    const report = userData.report;
    if (!report) {
      this.notificationService.showError('No report found to delete.');
      return;
    }

    if (report.status === 'published') {
       try {
        await this.dataService.updateChargebackReport(report.id, { status: 'draft' });
        this.notificationService.showSuccess(`Report for ${userData.user.name} reverted to draft.`);
      } catch(e) {
         this.notificationService.showError('Failed to unpublish report.');
      }
    } else {
      try {
        await this.dataService.deleteChargebackReport(report.id);
        this.notificationService.showSuccess(`Draft report for ${userData.user.name} deleted.`);
      } catch(e) {
        this.notificationService.showError('Failed to delete report.');
      }
    }
  }

  getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  private formatCurrency(value: number): string {
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
}
