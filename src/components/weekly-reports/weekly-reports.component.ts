import { Component, ChangeDetectionStrategy, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { UiStateService } from '../../services/ui-state.service';
import { NotificationService } from '../../services/notification.service';
import { ProcessedTechnician, User } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

declare var XLSX: any;

interface WeekOption {
  id: string; // ISO string of week start date
  display: string;
  startDate: Date;
  endDate: Date;
}

@Component({
  selector: 'app-weekly-reports',
  standalone: true,
  imports: [CommonModule, ConfirmationModalComponent, DatePipe, CurrencyPipe],
  templateUrl: './weekly-reports.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportsComponent implements OnInit {
  private dataService = inject(DatabaseService);
  private uiStateService = inject(UiStateService);
  private notificationService = inject(NotificationService);
  private datePipe: DatePipe;
  
  isPublishing = signal(false);
  showPublishConfirm = signal(false);
  selectedWeekId = signal<string | null>(null);
  selectedTechnicianId = signal<string|null>(null);
  
  // New Filters
  selectedTechId = signal<string>('all');
  customStartDateInput = signal('');
  customEndDateInput = signal('');

  customStartDate = computed(() => this.formatDateToYyyyMmDd(this.customStartDateInput()));
  customEndDate = computed(() => this.formatDateToYyyyMmDd(this.customEndDateInput()));

  technicians = computed<User[]>(() => 
    this.dataService.users().filter(u => u.role === 'employee' || u.role === 'sub-admin')
  );

  availableWeeks = computed<WeekOption[]>(() => {
    const jobs = this.dataService.jobs();
    const adjustments = this.dataService.adjustments();
    if (jobs.length === 0 && adjustments.length === 0) return [];

    const weekStarts = new Map<string, Date>();
    [...jobs, ...adjustments].forEach(item => {
      const itemDate = this.dataService.parseDateAsUTC(item.date);
      if (isNaN(itemDate.getTime())) return;
      const weekStart = this.dataService.getStartOfWeek(itemDate);
      if (isNaN(weekStart.getTime())) return;
      weekStarts.set(weekStart.toISOString(), weekStart);
    });

    return Array.from(weekStarts.entries()).map(([weekStartId, startDate]) => {
      const endDate = new Date(startDate);
      endDate.setUTCDate(startDate.getUTCDate() + 6);
      endDate.setUTCHours(23, 59, 59, 999);
      return { id: weekStartId, startDate, endDate, display: `${this.datePipe.transform(startDate, 'mediumDate', 'UTC')} - ${this.datePipe.transform(endDate, 'mediumDate', 'UTC')}` };
    }).sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  });
  
  allJobsProcessed = computed(() => this.dataService.publishedPayrolls().length > 0 && this.availableWeeks().length === 0);

  dateRange = computed<{start: Date | null, end: Date | null}>(() => {
    const week = this.availableWeeks().find(w => w.id === this.selectedWeekId());
    if (week) {
        return { start: week.startDate, end: week.endDate };
    }
    const start = this.customStartDate();
    const end = this.customEndDate();
    if (start && end) {
        const startDate = this.dataService.parseDateAsUTC(start);
        const endDate = this.dataService.parseDateAsUTC(end);
        endDate.setUTCHours(23, 59, 59, 999);
        return { start: startDate, end: endDate };
    }
    return { start: null, end: null };
  });

  filteredJobs = computed(() => {
    const { start, end } = this.dateRange();
    if (!start || !end) return [];
    
    let jobs = this.dataService.jobs().filter(job => {
      const jobDate = this.dataService.parseDateAsUTC(job.date);
      return jobDate >= start && jobDate <= end;
    });

    const techId = this.selectedTechId();
    if (techId !== 'all') {
        jobs = jobs.filter(job => job.techId === techId);
    }
    
    return jobs;
  });

  processedReport = computed(() => {
    const { start, end } = this.dateRange();
    if (!start || !end) return null;

    let jobsToProcess = this.filteredJobs();
    
    const report = this.dataService.processPayrollForJobs(jobsToProcess, start, end);
    const techId = this.selectedTechId();
    if (techId !== 'all') {
        return report.filter(tech => tech.techId === techId);
    }
    return report;
  });

  reportSummary = computed(() => {
    const report = this.processedReport();
    if (!report) return { totalPayout: 0, totalCompanyRevenue: 0, totalJobs: 0 };

    const totalPayoutInCents = report.reduce((sum, t) => sum + Math.round((t.totalEarnings || 0) * 100), 0);
    const totalCompanyRevenueInCents = report.reduce((sum, t) => sum + Math.round((t.companyRevenue || 0) * 100), 0);
    const totalJobs = report.reduce((sum, t) => sum + t.totalJobs, 0);

    return {
      totalPayout: totalPayoutInCents / 100,
      totalCompanyRevenue: totalCompanyRevenueInCents / 100,
      totalJobs,
    };
  });
  
  constructor() {
    this.datePipe = inject(DatePipe);
  }

  ngOnInit() {
    if (this.availableWeeks().length > 0) {
      this.selectedWeekId.set(this.availableWeeks()[0].id);
    }
  }

  selectWeek(event: Event) {
    const value = (event.target as HTMLSelectElement).value || null;
    this.selectedWeekId.set(value);
    if (value) {
      this.customStartDateInput.set('');
      this.customEndDateInput.set('');
    }
  }

  selectTechnician(event: Event) {
    this.selectedTechId.set((event.target as HTMLSelectElement).value);
  }

  onCustomDateChange() {
    if (this.customStartDate() && this.customEndDate()) {
        if(this.customStartDate()! > this.customEndDate()!) {
            this.notificationService.showError("Start date cannot be after end date.");
            return;
        }
        this.selectedWeekId.set(null);
    }
  }

  handleStartDateChange(event: Event): void {
    this.customStartDateInput.set((event.target as HTMLInputElement).value);
    this.onCustomDateChange();
  }

  handleEndDateChange(event: Event): void {
    this.customEndDateInput.set((event.target as HTMLInputElement).value);
    this.onCustomDateChange();
  }

  private formatDateToYyyyMmDd(dateStr: string): string | null {
    if (!dateStr) return null;

    // Handle YYYY-MM-DD format directly and validate
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(Date.UTC(year, month - 1, day));
      if (d && d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) {
        return dateStr;
      }
    }

    const digitsOnly = dateStr.replace(/\D/g, '');
    let month: number, day: number, year: number;

    if (digitsOnly.length === 6) { // MMDDYY
      month = parseInt(digitsOnly.substring(0, 2), 10);
      day = parseInt(digitsOnly.substring(2, 4), 10);
      year = parseInt(digitsOnly.substring(4, 6), 10);
      year += (year < 50 ? 2000 : 1900);
    } else if (digitsOnly.length === 8) { // MMDDYYYY
      month = parseInt(digitsOnly.substring(0, 2), 10);
      day = parseInt(digitsOnly.substring(2, 4), 10);
      year = parseInt(digitsOnly.substring(4, 8), 10);
    } else if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        month = parseInt(parts[0], 10);
        day = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
        if (year < 100) {
          year += (year < 50 ? 2000 : 1900);
        }
      } else {
        return null;
      }
    } else {
      return null;
    }

    if (isNaN(month) || isNaN(day) || isNaN(year) || year < 1900 || year > 2100) {
      return null;
    }
    
    // Final date validation
    const testDate = new Date(Date.UTC(year, month - 1, day));
    if (testDate.getUTCFullYear() !== year || testDate.getUTCMonth() !== month - 1 || testDate.getUTCDate() !== day) {
      return null;
    }
    
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  toggleTechnicianDetails(techId: string) {
    this.selectedTechnicianId.update(current => current === techId ? null : techId);
  }

  publishPayroll(): void {
    console.log('[Weekly Reports] 1. "Publish Payroll" button clicked.');
    const report = this.processedReport();
    
    if (!report || report.length === 0) {
        this.notificationService.showError("No data to publish.");
        console.log('[Weekly Reports] 2. ❌ Aborted: No report data to publish.');
        return;
    }
    
    const { start, end } = this.dateRange();
    if (!start || !end) {
        this.notificationService.showError("Please select a valid date range.");
        console.log('[Weekly Reports] 2. ❌ Aborted: Invalid date range selected.');
        return;
    }
    
    console.log('[Weekly Reports] 2. Showing confirmation modal for publication.');
    this.showPublishConfirm.set(true);
  }

  async handlePublish(confirmed: boolean): Promise<void> {
    this.showPublishConfirm.set(false);
    
    if (!confirmed) {
        console.log('[Weekly Reports] 4. User cancelled publication.');
        return;
    }
      
    console.log('[Weekly Reports] 4. User confirmed publication.');
    const report = this.processedReport();
    const jobs = this.filteredJobs();
    const { start, end } = this.dateRange();

    // Redundant checks, but good for safety
    if (!report || report.length === 0 || !start || !end || !jobs) {
        this.notificationService.showError("Data became invalid during confirmation. Please try again.");
        console.error('[Weekly Reports] ❌ Aborted: Data was invalid after confirmation.');
        return;
    }
    
    const startDate = start.toISOString().split('T')[0];
    const endDate = end.toISOString().split('T')[0];
    
    console.log(`[Weekly Reports] 3. Report contains ${report.length} technician(s) and ${jobs.length} job(s).`);

    this.isPublishing.set(true);
    try {
        console.log('[Weekly Reports] 5. Calling dataService.publishPayroll...');
        const payrollId = await this.dataService.publishPayroll(report, jobs, startDate, endDate);
        console.log(`[Weekly Reports] 6. ✅ Successfully published. Received payroll ID: ${payrollId}`);
        this.notificationService.showSuccess('Payroll published successfully! Navigating to history...');
        this.uiStateService.adminActiveTab.set('history');
        this.uiStateService.navigateToPayrollId.set(payrollId);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Weekly Reports] 6. ❌ Error during publish process:`, error);
        this.notificationService.showError(msg);
    } finally {
        this.isPublishing.set(false);
        console.log('[Weekly Reports] 7. Publish process finished.');
    }
  }

  downloadExcel() {
    const report = this.processedReport();
    if (!report || report.length === 0) return;
    
    const dataForSheet = report.map(tech => ({
        'Tech ID': tech.techId, 'Name': tech.name, 'Jobs': tech.totalJobs, 
        'Revenue': tech.totalRevenue, 'Base Pay': tech.totalEarnings - this.getAdjustmentsTotal(tech),
        'Adjustments': this.getAdjustmentsTotal(tech), 'Final Pay': tech.totalEarnings, 'Co. Revenue': tech.companyRevenue,
    }));
    const worksheet = XLSX.utils.json_to_sheet(dataForSheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Payroll Report');
    XLSX.writeFile(workbook, `payroll_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  getAdjustmentsTotal(tech: ProcessedTechnician): number {
    if (!tech.adjustments || tech.adjustments.length === 0) return 0;
    const totalInCents = tech.adjustments.reduce((sum, adj) => sum + Math.round((adj.amount || 0) * 100), 0);
    return totalInCents / 100;
  }
}