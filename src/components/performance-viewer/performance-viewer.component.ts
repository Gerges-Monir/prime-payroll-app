import { Component, ChangeDetectionStrategy, inject, computed, signal, input, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { User, PerformanceReport } from '../../models/payroll.model';

interface WeekOption {
  id: string; // ISO string of week start date
  display: string;
}

@Component({
  selector: 'app-performance-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './performance-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerformanceViewerComponent {
  private dataService = inject(DatabaseService);
  
  // Inputs to control the mode of the component
  userId = input<string | null>(null); // For single employee view
  teamUsers = input<User[]>([]); // For sub-admin team view

  selectedWeek = signal<string>('');
  selectedTeamUserId = signal<string | null>(null);

  isTeamView = computed(() => this.teamUsers().length > 0);
  
  userMap = computed(() => new Map(this.dataService.users().map(u => [u.id, u])));

  availableWeeks = computed<WeekOption[]>(() => {
    const reports = this.dataService.performanceReports().filter(r => r.status === 'published');
    const weekStarts = new Set<string>();
    
    reports.forEach(report => {
        weekStarts.add(report.weekStartDate);
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

  currentReport = computed<PerformanceReport | null>(() => {
    const week = this.selectedWeek();
    const targetUserId = this.isTeamView() ? this.selectedTeamUserId() : this.userId();
    
    if (!week || !targetUserId) return null;

    const reportId = `${week}_${targetUserId}`;
    return this.dataService.performanceReports().find(r => r.id === reportId && r.status === 'published') ?? null;
  });

  constructor() {
    effect(() => {
        const weeks = this.availableWeeks();
        if (weeks.length > 0 && !this.selectedWeek()) {
            this.selectedWeek.set(weeks[0].id);
        }
    });
  }

  downloadImage(): void {
    const report = this.currentReport();
    if (!report) return;

    const a = document.createElement('a');
    a.href = report.imageDataUrl;
    a.download = `Performance_Report_${this.userMap().get(report.userId)?.name}_${report.weekStartDate}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
