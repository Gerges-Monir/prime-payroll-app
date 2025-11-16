import { Component, ChangeDetectionStrategy, inject, computed, signal, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { DashboardHeaderComponent } from '../shared/dashboard-header/dashboard-header.component';
import { StatCardsComponent } from '../shared/stat-cards/stat-cards.component';
import { SidebarComponent } from '../shared/sidebar/sidebar.component';
import { User, Job, ProcessedTechnician, PublishedPayroll, RateCategory } from '../../models/payroll.model';

declare var XLSX: any;

type SubAdminTab = 'report' | 'jobs' | 'team' | 'teamHistory';

@Component({
  selector: 'app-sub-admin-dashboard',
  standalone: true,
  templateUrl: './sub-admin-dashboard.component.html',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SidebarComponent,
    DashboardHeaderComponent,
    StatCardsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubAdminDashboardComponent {
  private dataService = inject(DatabaseService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  currentUser = this.authService.currentUser;
  activeTab = signal<SubAdminTab>('report');
  
  tabs: { id: SubAdminTab, name: string, icon: string }[] = [
    { id: 'report', name: 'Current Payroll', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" />' },
    { id: 'jobs', name: 'Unprocessed Jobs', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />' },
    { id: 'team', name: 'My Team', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-4.663M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Z" />' },
    { id: 'teamHistory', name: 'Payroll History', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />' }
  ];

  rateCategories = this.dataService.rateCategories;

  assignedEmployeeIds = computed(() => {
    const currentUserId = this.currentUser()?.id;
    if (!currentUserId) return new Set<number>();
    const ids = this.dataService.users().filter(u => u.assignedTo === currentUserId).map(u => u.id);
    return new Set(ids);
  });
  
  teamMembers = computed(() => {
    const ids = this.assignedEmployeeIds();
    return this.dataService.users().filter(u => ids.has(u.id));
  });

  teamTechIds = computed(() => new Set(this.teamMembers().map(u => u.techId)));

  teamJobs = computed(() => {
    const techIds = this.teamTechIds();
    return this.dataService.jobs().filter(job => techIds.has(job.techId));
  });

  teamProcessedTechnicians = computed(() => {
    const techIds = this.teamTechIds();
    techIds.add(this.currentUser()?.techId || '');
    return this.dataService.processedTechnicians().filter(p => techIds.has(p.techId));
  });

  teamStats = computed(() => {
    const techs = this.teamProcessedTechnicians();
    return [
       { label: 'Team Members', value: this.teamMembers().length.toString(), icon: '', color: 'blue', description: 'Managed by you' },
       { label: 'Team Jobs', value: techs.reduce((s, t) => s + t.totalJobs, 0).toString(), icon: '', color: 'orange', description: 'Current unprocessed jobs' },
       { label: 'Team Payout', value: `$${techs.reduce((s, t) => s + t.totalEarnings, 0).toFixed(2)}`, icon: '', color: 'green', description: 'Estimated for this period' },
       { label: 'Team Co. Revenue', value: `$${techs.reduce((s, t) => s + t.companyRevenue, 0).toFixed(2)}`, icon: '', color: 'purple', description: 'From team jobs' },
    ];
  });
  
  showJobModal = signal(false);
  isSavingJob = signal(false);
  jobToEdit: WritableSignal<Job | null> = signal(null);
  jobForm: FormGroup;
  
  teamPayrollHistory = computed(() => {
    const teamUserIds = new Set([...this.teamMembers().map(u => u.id), this.currentUser()?.id]);
    return this.dataService.publishedPayrolls()
      .filter(p => p.status === 'finalized')
      .map(p => ({ ...p, reportData: p.reportData.filter(rd => teamUserIds.has(rd.id)) }))
      .filter(p => p.reportData.length > 0);
  });

  selectedTeamPayrollId = signal<string | null>(null);
  selectedReportTechnicianId = signal<number | null>(null);

  selectedTeamPayroll = computed(() => this.teamPayrollHistory().find(p => p.id === this.selectedTeamPayrollId()) ?? null);
  
  selectedTechnicianJobs = computed(() => {
    const techId = this.teamProcessedTechnicians().find(t => t.id === this.selectedReportTechnicianId())?.techId;
    if (!techId) return [];
    return this.teamJobs().filter(j => j.techId === techId);
  });

  constructor() {
    this.fb = inject(FormBuilder);
    this.jobForm = this.fb.group({
      techId: [{value: '', disabled: true}, Validators.required],
      date: ['', Validators.required],
      taskCode: ['', Validators.required],
      revenue: ['', [Validators.required, Validators.min(0)]],
    });
  }

  selectTab(tab: SubAdminTab) { this.activeTab.set(tab); }
  selectTeamPayroll(payrollId: string) { this.selectedTeamPayrollId.set(payrollId); }
  getTechName(techId: string): string { return this.dataService.users().find(u => u.techId === techId)?.name || 'Unknown'; }
  openEditJobModal(job: Job) { this.jobToEdit.set(job); this.jobForm.patchValue(job); this.showJobModal.set(true); }
  closeJobModal() { this.showJobModal.set(false); this.jobToEdit.set(null); }

  toggleTechnicianDetails(techId: number) {
    this.selectedReportTechnicianId.update(current => current === techId ? null : techId);
  }

  getRateCategoryName(id: number | undefined): string {
    if (id === undefined) return 'Not Assigned';
    return this.rateCategories().find(c => c.id === id)?.name || 'Unknown Category';
  }

  async saveJob(): Promise<void> {
    if (this.jobForm.invalid) return;
    const editingJob = this.jobToEdit();
    if (!editingJob) return;

    this.isSavingJob.set(true);
    try {
        await this.dataService.updateJob({ ...editingJob, ...this.jobForm.getRawValue() });
        this.notificationService.showSuccess('Job updated successfully.');
        this.closeJobModal();
    } catch(e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        this.notificationService.showError(errorMessage);
    } finally {
        this.isSavingJob.set(false);
    }
  }
  
  async deleteJob(jobId: number): Promise<void> {
    if (confirm('Are you sure you want to delete this job?')) {
      await this.dataService.deleteJob(jobId);
      this.notificationService.showSuccess('Job deleted successfully.');
    }
  }

  downloadExcel() {
    const data = this.teamProcessedTechnicians().map(tech => ({
      'Tech ID': tech.techId, 'Name': tech.name, 'Jobs': tech.totalJobs, 'Revenue': tech.totalRevenue,
      'Adjustments': this.getAdjustmentsTotal(tech), 'Payout': tech.totalEarnings, 'Co. Revenue': tech.companyRevenue,
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Team Report');
    XLSX.writeFile(workbook, `team_report_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  getAdjustmentsTotal(tech: ProcessedTechnician): number {
    return tech.adjustments.reduce((sum, adj) => sum + adj.amount, 0);
  }

  logout(): void { this.authService.logout(); }
}