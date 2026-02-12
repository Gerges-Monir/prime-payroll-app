import { Component, ChangeDetectionStrategy, inject, computed, signal, WritableSignal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { NotificationService } from '../../services/notification.service';
import { User, PerformanceReport } from '../../models/payroll.model';
import { PerformanceChartComponent } from '../shared/performance-chart/performance-chart.component';
import { PerformanceService } from '../../services/performance.service';

declare var XLSX: any;
declare var html2canvas: any;

interface WeekOption {
  id: string; // ISO string of week start date
  display: string;
}

@Component({
  selector: 'app-performance-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, PerformanceChartComponent],
  templateUrl: './performance-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerformanceManagementComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private performanceService = inject(PerformanceService);

  allUsers = computed(() => 
    this.dataService.users().filter(u => u.role === 'employee' || u.role === 'sub-admin')
  );

  availableWeeks = computed<WeekOption[]>(() => {
    const unprocessedJobs = this.dataService.jobs();
    const allProcessedJobs: { date: string }[] = this.dataService.publishedPayrolls().flatMap(p => 
        p.reportData.flatMap(rd => rd.processedJobs.map(job => ({ date: job.date })))
    );
    const allJobs = [...unprocessedJobs, ...allProcessedJobs];
    
    const weekStarts = new Set<string>();
    allJobs.forEach(item => {
      const itemDate = this.dataService.parseDateAsUTC(item.date);
      if (isNaN(itemDate.getTime())) return;
      const weekStart = this.dataService.getStartOfWeek(itemDate);
      weekStarts.add(weekStart.toISOString().split('T')[0]);
    });

    return Array.from(weekStarts).map(startDateStr => {
      const startDate = this.dataService.parseDateAsUTC(startDateStr);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      return { 
        id: startDateStr, 
        display: `${startDate.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}`
      };
    }).sort((a, b) => new Date(b.id).getTime() - new Date(a.id).getTime());
  });

  dateInput = signal('');
  selectedWeek = computed(() => {
    const date = this.formatDateToYyyyMmDd(this.dateInput());
    if (!date) return '';
    const utcDate = this.dataService.parseDateAsUTC(date);
    const weekStart = this.dataService.getStartOfWeek(utcDate);
    return weekStart.toISOString().split('T')[0];
  });
  
  employeeReportData = computed(() => {
    const week = this.selectedWeek();
    if (!week) return [];
    
    const performanceReports = this.dataService.performanceReports();
    return this.allUsers().map(user => {
        const reportId = `${week}_${user.id}`;
        const existingReport = performanceReports.find(r => r.id === reportId);
        return {
          user,
          report: existingReport,
          previewUrl: signal<string | null>(existingReport?.imageDataUrl || null),
          notes: signal<string>(existingReport?.notes || ''),
        };
    });
  });

  hasDraftsForWeek = computed(() => {
    return this.employeeReportData().some(data => data.report && data.report.status === 'draft');
  });

  // New properties for chart generation
  metricsFile = signal<File | null>(null);
  isProcessingFile = signal(false);
  chartsToGenerate = signal<{ techData: any, perfData: any }[] | null>(null);
  showFormatHelp = signal(false);

  constructor() {
    effect(() => {
        const weeks = this.availableWeeks();
        if (weeks.length > 0 && !this.dateInput()) {
            this.dateInput.set(this.formatDateToMmDdYy(weeks[0].id));
        }
    });
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

  private formatDateToMmDdYy(dateStr: string | null): string {
    if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return '';
    const [year, month, day] = dateStr.split('-');
    return `${month}/${day}/${String(year).slice(-2)}`;
  }

  onFileSelected(event: Event, userData: any): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) { // 2MB limit
      this.notificationService.showError('File size must be under 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => userData.previewUrl.set(reader.result as string);
    reader.readAsDataURL(file);
  }

  async saveReport(userData: any): Promise<void> {
    const week = this.selectedWeek();
    const previewUrl = userData.previewUrl();
    if (!week) {
      this.notificationService.showError('Please select a week before saving.');
      return;
    }
     if (!previewUrl) {
      this.notificationService.showError('Please upload an image before saving.');
      return;
    }
    
    const reportData = {
        userId: userData.user.id,
        weekStartDate: week,
        imageDataUrl: previewUrl,
        notes: userData.notes(),
    };

    try {
        await this.dataService.addOrUpdatePerformanceReport(reportData);
        this.notificationService.showSuccess(`Performance report for ${userData.user.name} saved.`);
    } catch(e) {
        this.notificationService.showError('Failed to save report.');
    }
  }

  async publishAllForWeek(): Promise<void> {
    const week = this.selectedWeek();
    if (!week) return;

    try {
        await this.dataService.publishPerformanceReportsForWeek(week);
        this.notificationService.showSuccess(`All draft reports for the week have been published.`);
    } catch(e) {
        this.notificationService.showError('Failed to publish reports.');
    }
  }

  async deleteReport(userData: any): Promise<void> {
    const report = userData.report as PerformanceReport;
    if (!report) {
      this.notificationService.showError('No report found to delete.');
      return;
    }
    
    if (report.status === 'published') {
      try {
        await this.dataService.updatePerformanceReport(report.id, { status: 'draft' });
        this.notificationService.showSuccess(`Report for ${userData.user.name} reverted to draft.`);
      } catch (e) {
        this.notificationService.showError('Failed to unpublish report.');
      }
    } else {
      try {
        await this.dataService.deletePerformanceReport(report.id);
        userData.previewUrl.set(null);
        userData.notes.set('');
        this.notificationService.showSuccess(`Draft report for ${userData.user.name} deleted.`);
      } catch(e) {
        this.notificationService.showError('Failed to delete report.');
      }
    }
  }

  getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  onMetricsFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.metricsFile.set(input.files[0]);
    } else {
      this.metricsFile.set(null);
    }
  }

  async processAndGenerateCharts() {
    if (!this.metricsFile()) {
        this.notificationService.showError("Please select a file first.");
        return;
    }
    if (!this.selectedWeek()) {
        this.notificationService.showError("Please select a week first.");
        return;
    }

    this.isProcessingFile.set(true);
    
    try {
        // FIX: Destructure `technicians` array from the service method's return object.
        const { technicians: techsFromFile } = await this.performanceService.parseAndCleanFile(this.metricsFile()!);
        const weekStartDate = this.dataService.parseDateAsUTC(this.selectedWeek());
        const monthName = weekStartDate.toLocaleString('en-US', { timeZone: 'UTC', month: 'long' }).toUpperCase();
        
        const chartsData = techsFromFile.map(tech => {
            const safeTechData = { ...tech };
            // Ensure all numeric data for charts is non-negative to prevent style errors
            for (const key in safeTechData) {
                if (Object.prototype.hasOwnProperty.call(safeTechData, key) && typeof safeTechData[key] === 'number') {
                    safeTechData[key] = Math.max(0, safeTechData[key]);
                }
            }
            return {
                techData: safeTechData,
                perfData: this.performanceService.calculatePerformance(safeTechData, monthName)
            };
        });

        this.chartsToGenerate.set(chartsData);

        await new Promise(resolve => setTimeout(resolve, 200));

        let generatedCount = 0;
        for (const data of chartsData) {
            const techId = String(data.techData['Tech #']).trim();
            const element = document.getElementById(`chart-gen-${techId}`);
            if (element) {
                try {
                    const canvas = await html2canvas(element, { scale: 1.5 });
                    const dataUrl = canvas.toDataURL('image/png');
                    const userForReport = this.employeeReportData().find(d => d.user.techId === techId);
                    if (userForReport) {
                        userForReport.previewUrl.set(dataUrl);
                        generatedCount++;
                    }
                } catch (e) {
                    console.error(`Failed to generate chart for Tech #${techId}`, e);
                }
            }
        }
        
        this.notificationService.showSuccess(`Generated and applied ${generatedCount} performance charts.`);

    } catch (e) {
        const message = e instanceof Error ? e.message : "An unknown error occurred during processing.";
        this.notificationService.showError(message);
    } finally {
        this.chartsToGenerate.set(null);
        this.metricsFile.set(null);
        this.isProcessingFile.set(false);
    }
  }
}
