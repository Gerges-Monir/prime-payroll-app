import { Component, ChangeDetectionStrategy, inject, computed, output, signal, OnInit, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { UiStateService } from '../../services/ui-state.service';
import { NotificationService } from '../../services/notification.service';
import { ProcessedTechnician, Adjustment, Job } from '../../models/payroll.model';

declare var XLSX: any;

interface WeekOption {
  id: string; // ISO string of week start date
  display: string;
  startDate: Date;
  endDate: Date;
}

interface DayFilter {
    date: Date;
    dayName: string;
    dayOfMonth: number;
    dayIndex: number;
}

@Component({
  selector: 'app-weekly-reports',
  standalone: true,
  imports: [CommonModule],
  providers: [DatePipe],
  templateUrl: './weekly-reports.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportsComponent implements OnInit {
  private dataService = inject(DatabaseService);
  private uiStateService = inject(UiStateService);
  private notificationService = inject(NotificationService);
  private datePipe: DatePipe;
  
  isPublishing = signal(false);
  selectedWeekId = signal<string | null>(null);

  // Day Filtering State
  private dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  selectedDays = signal<Record<number, boolean>>({ 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true });

  availableWeeks = computed<WeekOption[]>(() => {
    const jobs = this.dataService.jobs();
    const adjustments = this.dataService.adjustments();
    if (jobs.length === 0 && adjustments.length === 0) return [];

    const weekStarts = new Map<string, Date>();
    [...jobs, ...adjustments].forEach(item => {
      const itemDate = this.dataService.parseDateAsUTC(item.date);
      if (isNaN(itemDate.getTime())) return;
      const weekStart = this.dataService.getStartOfWeek(itemDate);
      weekStarts.set(weekStart.toISOString(), weekStart);
    });

    return Array.from(weekStarts.entries()).map(([weekStartId, startDate]) => {
      const endDate = new Date(startDate);
      endDate.setUTCDate(startDate.getUTCDate() + 6);
      return { id: weekStartId, startDate, endDate, display: `${this.datePipe.transform(startDate, 'mediumDate', 'UTC')} - ${this.datePipe.transform(endDate, 'mediumDate', 'UTC')}` };
    }).sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  });

  dayFilters = computed<DayFilter[]>(() => {
    const week = this.availableWeeks().find(w => w.id === this.selectedWeekId());
    if (!week) return [];
    return Array.from({ length: 7 }, (_, i) => {
        const date = new Date(week.startDate);
        date.setUTCDate(date.getUTCDate() + i);
        return { date, dayName: this.dayNames[i], dayOfMonth: date.getUTCDate(), dayIndex: i };
    });
  });

  allJobsProcessed = computed(() => this.dataService.publishedPayrolls().length > 0 && this.availableWeeks().length === 0);

  jobsForSelectedWeek = computed(() => {
    const week = this.availableWeeks().find(w => w.id === this.selectedWeekId());
    if (!week) return [];
    return this.dataService.jobs().filter(job => {
      const jobDate = this.dataService.parseDateAsUTC(job.date);
      return jobDate >= week.startDate && jobDate <= week.endDate;
    });
  });

  filteredJobsForSelectedWeek = computed(() => {
    const jobsInWeek = this.jobsForSelectedWeek();
    const activeDayIndexes = Object.keys(this.selectedDays()).filter(k => this.selectedDays()[Number(k)]).map(Number);
    if (activeDayIndexes.length === 7) return jobsInWeek;
    return jobsInWeek.filter(job => activeDayIndexes.includes(this.dataService.parseDateAsUTC(job.date).getUTCDay()));
  });

  reportForSelectedWeek = computed(() => {
    const weekId = this.selectedWeekId();
    if (!weekId) return null;
    const selectedDaysMap = this.selectedDays();
    const selectedDates = this.dayFilters().filter(d => selectedDaysMap[d.dayIndex]).map(d => d.date);

    if (selectedDates.length === 0) {
        return this.dataService.processPayrollForJobs(this.filteredJobsForSelectedWeek(), new Date(0), new Date(0));
    }
    const reportStartDate = selectedDates[0];
    const reportEndDate = new Date(selectedDates[selectedDates.length - 1]);
    reportEndDate.setUTCHours(23, 59, 59, 999);
    return this.dataService.processPayrollForJobs(this.filteredJobsForSelectedWeek(), reportStartDate, reportEndDate);
  });

  reportSummary = computed(() => {
    const report = this.reportForSelectedWeek();
    if (!report) return { totalPayout: 0, totalCompanyRevenue: 0, totalJobs: 0 };
    return {
      totalPayout: report.reduce((sum, t) => sum + t.totalEarnings, 0),
      totalCompanyRevenue: report.reduce((sum, t) => sum + t.companyRevenue, 0),
      totalJobs: report.reduce((sum, t) => sum + t.totalJobs, 0),
    };
  });
  
  constructor() {
    this.datePipe = inject(DatePipe);
    effect(() => {
        this.selectedWeekId();
        this.selectedDays.set({ 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true });
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    if (this.availableWeeks().length > 0) {
      this.selectedWeekId.set(this.availableWeeks()[0].id);
    }
  }

  selectWeek(event: Event) {
    this.selectedWeekId.set((event.target as HTMLSelectElement).value || null);
  }

  toggleDay(dayIndex: number): void {
    this.selectedDays.update(days => ({ ...days, [dayIndex]: !days[dayIndex] }));
  }

  async publishPayroll(): Promise<void> {
    const report = this.reportForSelectedWeek();
    const jobs = this.filteredJobsForSelectedWeek();
    
    if (!report || report.length === 0) {
        this.notificationService.showError("No data to publish.");
        return;
    }

    const selectedDates = this.dayFilters().filter(d => this.selectedDays()[d.dayIndex]).map(d => d.date);
    if (selectedDates.length === 0) {
        this.notificationService.showError("Please select at least one day.");
        return;
    }
    
    const startDate = selectedDates[0].toISOString().split('T')[0];
    const endDate = selectedDates[selectedDates.length - 1].toISOString().split('T')[0];

    if (confirm(`Publish payroll for ${startDate} to ${endDate}? This is final and will be visible to employees.`)) {
      this.isPublishing.set(true);
      try {
        const payrollId = await this.dataService.publishPayroll(report, jobs, startDate, endDate);
        this.notificationService.showSuccess('Payroll published successfully! Navigating to history...');
        this.uiStateService.adminActiveTab.set('history');
        this.uiStateService.navigateToPayrollId.set(payrollId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.notificationService.showError(msg);
      } finally {
        this.isPublishing.set(false);
      }
    }
  }

  downloadExcel() {
    const report = this.reportForSelectedWeek();
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
    return tech.adjustments.reduce((sum, adj) => sum + adj.amount, 0);
  }
}