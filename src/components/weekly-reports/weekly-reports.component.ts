import { Component, ChangeDetectionStrategy, inject, computed, output, signal, OnInit, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MockDataService } from '../../services/mock-data.service';
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
  private dataService = inject(MockDataService);
  private datePipe = inject(DatePipe);

  payrollPublished = output<string>();
  
  selectedWeekId = signal<string | null>(null);

  // Day Filtering State
  private dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  selectedDays = signal<Record<number, boolean>>({ 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true });

  availableWeeks = computed<WeekOption[]>(() => {
    const jobs = this.dataService.jobs();
    const adjustments = this.dataService.adjustments();

    if (jobs.length === 0 && adjustments.length === 0) return [];

    const weekStarts = new Map<string, Date>();

    jobs.forEach(job => {
      const jobDate = this.dataService.parseDateAsUTC(job.date);
      if (isNaN(jobDate.getTime())) return;

      const weekStart = this.dataService.getStartOfWeek(jobDate);
      const weekStartId = weekStart.toISOString();
      
      if (!weekStarts.has(weekStartId)) {
        weekStarts.set(weekStartId, weekStart);
      }
    });

    // Also consider weeks from one-time adjustments
    adjustments.forEach(adj => {
      const adjDate = this.dataService.parseDateAsUTC(adj.date);
      if (isNaN(adjDate.getTime())) return;
      
      const weekStart = this.dataService.getStartOfWeek(adjDate);
      const weekStartId = weekStart.toISOString();

      if (!weekStarts.has(weekStartId)) {
        weekStarts.set(weekStartId, weekStart);
      }
    });

    const weeks: WeekOption[] = Array.from(weekStarts.entries()).map(([weekStartId, startDate]) => {
      const endDate = new Date(startDate);
      endDate.setUTCDate(startDate.getUTCDate() + 6);
      return {
        id: weekStartId,
        display: `${this.datePipe.transform(startDate, 'mediumDate', 'UTC')} - ${this.datePipe.transform(endDate, 'mediumDate', 'UTC')}`,
        startDate,
        endDate,
      };
    });
    
    return weeks.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  });

  dayFilters = computed<DayFilter[]>(() => {
    const weekId = this.selectedWeekId();
    if (!weekId) return [];

    const week = this.availableWeeks().find(w => w.id === weekId);
    if (!week) return [];
    
    const days: DayFilter[] = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(week.startDate);
        date.setUTCDate(date.getUTCDate() + i);
        days.push({
            date: date,
            dayName: this.dayNames[i],
            dayOfMonth: date.getUTCDate(),
            dayIndex: i,
        });
    }
    return days;
  });

  allJobsProcessed = computed(() => {
    return this.dataService.publishedPayrolls().length > 0 && this.availableWeeks().length === 0;
  });

  jobsForSelectedWeek = computed(() => {
    const weekId = this.selectedWeekId();
    if (!weekId) return [];

    const week = this.availableWeeks().find(w => w.id === weekId);
    if (!week) return [];

    const startDate = week.startDate;
    const endDate = new Date(week.endDate);
    endDate.setUTCHours(23, 59, 59, 999);

    return this.dataService.jobs().filter(job => {
      const jobDate = this.dataService.parseDateAsUTC(job.date);
       if (isNaN(jobDate.getTime())) return false;
      return jobDate >= startDate && jobDate <= endDate;
    });
  });

  filteredJobsForSelectedWeek = computed(() => {
    const jobsInWeek = this.jobsForSelectedWeek();
    const days = this.selectedDays();
    const activeDayIndexes = Object.keys(days).filter(k => days[Number(k)]).map(Number);

    if (activeDayIndexes.length === 7) {
      return jobsInWeek;
    }

    return jobsInWeek.filter(job => {
      const jobDate = this.dataService.parseDateAsUTC(job.date);
      if (isNaN(jobDate.getTime())) return false;
      const jobDayIndex = jobDate.getUTCDay();
      return activeDayIndexes.includes(jobDayIndex);
    });
  });

  reportForSelectedWeek = computed(() => {
    const jobs = this.filteredJobsForSelectedWeek();
    const weekId = this.selectedWeekId();
    if (!weekId) return null;

    const currentDayFilters = this.dayFilters();
    if (currentDayFilters.length === 0) return null;

    const selectedDaysMap = this.selectedDays();
    const selectedDates = currentDayFilters
        .filter(d => selectedDaysMap[d.dayIndex])
        .map(d => d.date);

    // If no days are selected, we should not process any one-time adjustments.
    // We pass an invalid date range to ensure only recurring/loan adjustments are calculated.
    if (selectedDates.length === 0) {
        return this.dataService.processPayrollForJobs(jobs, new Date(0), new Date(0));
    }

    const reportStartDate = selectedDates[0];
    const reportEndDate = new Date(selectedDates[selectedDates.length - 1]);
    reportEndDate.setUTCHours(23, 59, 59, 999);

    // Pass the NARROWED date range to get accurate, date-filtered adjustments
    return this.dataService.processPayrollForJobs(jobs, reportStartDate, reportEndDate);
  });

  reportSummary = computed(() => {
    const report = this.reportForSelectedWeek();
    if (!report) {
      return { totalPayout: 0, totalCompanyRevenue: 0, totalJobs: 0 };
    }
    return {
      totalPayout: report.reduce((sum, t) => sum + t.totalEarnings, 0),
      totalCompanyRevenue: report.reduce((sum, t) => sum + t.companyRevenue, 0),
      totalJobs: report.reduce((sum, t) => sum + t.totalJobs, 0),
    };
  });
  
  constructor() {
    effect(() => {
        // When selected week changes, reset day filters to all selected
        this.selectedWeekId(); // depend on this signal
        this.selectedDays.set({ 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true });
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    if (this.availableWeeks().length > 0) {
      this.selectedWeekId.set(this.availableWeeks()[0].id);
    }
  }

  selectWeek(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.selectedWeekId.set(select.value || null);
  }

  toggleDay(dayIndex: number): void {
    this.selectedDays.update(days => ({
      ...days,
      [dayIndex]: !days[dayIndex]
    }));
  }

  publishPayroll(): void {
    const report = this.reportForSelectedWeek();
    const jobs = this.filteredJobsForSelectedWeek();
    
    if (!report) {
        alert("No data available for the selected days to publish.");
        return;
    }

    const currentDayFilters = this.dayFilters();
    const selectedDaysMap = this.selectedDays();
    const selectedDates = currentDayFilters
        .filter(d => selectedDaysMap[d.dayIndex])
        .map(d => d.date);
    
    if (jobs.length === 0 && report.every(r => r.adjustments.every(a => a.type !== 'Bonus' && a.type !== 'Chargeback'))) {
        alert("There are no jobs or one-time adjustments in the selected days to publish.");
        return;
    }

    if (selectedDates.length === 0) {
        alert("Please select at least one day to create a payroll draft.");
        return;
    }
    
    const startDate = selectedDates[0].toISOString().split('T')[0];
    const endDate = selectedDates[selectedDates.length - 1].toISOString().split('T')[0];

    if (confirm(`Create a draft payroll for ${startDate} to ${endDate}? This will remove the processed jobs and adjustments from the queue.`)) {
      try {
        const payrollId = this.dataService.publishPayroll(report, jobs, startDate, endDate);
        if (payrollId) {
          this.payrollPublished.emit(payrollId);
        }
      } catch (error) {
        console.error("Failed to publish payroll:", error);
        alert(`An error occurred while creating the payroll draft: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  downloadExcel() {
    const report = this.reportForSelectedWeek();
    if (!report || report.length === 0) return;
    
    const dataForSheet = report.map(tech => {
      const adjustmentTotal = this.getAdjustmentsTotal(tech);
      const baseEarnings = tech.totalEarnings - adjustmentTotal;

      return {
        'Tech ID': tech.techId,
        'Name': tech.name,
        'Total Jobs': tech.totalJobs,
        'Total Revenue': tech.totalRevenue,
        'Base Earnings': baseEarnings,
        'Adjustments Total': adjustmentTotal,
        'Final Payout': tech.totalEarnings,
        'Company Revenue': tech.companyRevenue,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataForSheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Weekly Payroll');

    const objectMaxLength: number[] = [];
    dataForSheet.forEach(obj => {
      Object.values(obj).forEach((value, i) => {
        const key = Object.keys(obj)[i];
        const headerLength = key.length;
        const valueLength = value?.toString().length ?? 0;
        objectMaxLength[i] = Math.max(objectMaxLength[i] || headerLength, valueLength);
      });
    });
    worksheet["!cols"] = objectMaxLength.map(w => ({ width: w + 2 }));

    XLSX.writeFile(workbook, `weekly_payroll_report_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  getAdjustmentsTotal(tech: ProcessedTechnician): number {
    return tech.adjustments.reduce((sum, adj) => sum + adj.amount, 0);
  }
}
