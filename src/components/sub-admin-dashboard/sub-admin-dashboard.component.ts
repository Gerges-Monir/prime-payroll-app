import { Component, ChangeDetectionStrategy, inject, computed, signal, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { MockDataService } from '../../services/mock-data.service';
import { AuthService } from '../../services/auth.service';
import { DashboardHeaderComponent } from '../shared/dashboard-header/dashboard-header.component';
import { StatCardsComponent } from '../shared/stat-cards/stat-cards.component';
import { User, Job, ProcessedTechnician, PublishedPayroll } from '../../models/payroll.model';

declare var XLSX: any;

type SubAdminTab = 'report' | 'jobs' | 'teamHistory';

@Component({
  selector: 'app-sub-admin-dashboard',
  standalone: true,
  templateUrl: './sub-admin-dashboard.component.html',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DashboardHeaderComponent,
    StatCardsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubAdminDashboardComponent {
  private dataService = inject(MockDataService);
  private authService = inject(AuthService);
  private fb: FormBuilder;

  currentUser = this.authService.currentUser;
  activeTab = signal<SubAdminTab>('report');
  
  tabs = [
    { id: 'report', name: '📊 Team Report' },
    { id: 'jobs', name: '🔧 Manage Jobs' },
    { id: 'teamHistory', name: '📚 Team History' }
  ];

  // Filtered data for this sub-admin's team
  assignedEmployeeIds = computed(() => {
    const currentUserId = this.currentUser()?.id;
    if (!currentUserId) return new Set<number>();
    const ids = this.dataService.users()
      .filter(u => u.assignedTo === currentUserId)
      .map(u => u.id);
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
    // Also include the sub-admin's own data
    techIds.add(this.currentUser()?.techId || '');
    return this.dataService.processedTechnicians().filter(p => techIds.has(p.techId));
  });

  teamStats = computed(() => {
    const techs = this.teamProcessedTechnicians();
    const totalJobs = techs.reduce((sum, tech) => sum + tech.totalJobs, 0);
    const totalPayout = techs.reduce((sum, tech) => sum + tech.totalEarnings, 0);
    const companyRevenue = techs.reduce((sum, tech) => sum + tech.companyRevenue, 0);
    return [
       { label: 'Team Members', value: this.teamMembers().length.toString(), icon: '👥', color: 'bg-blue-500' },
       { label: 'Team Jobs', value: totalJobs.toString(), icon: '🛠️', color: 'bg-indigo-500' },
       { label: 'Team Payout', value: `$${totalPayout.toFixed(2)}`, icon: '💰', color: 'bg-emerald-500' },
       { label: 'Team Co. Revenue', value: `$${companyRevenue.toFixed(2)}`, icon: '🏢', color: 'bg-amber-500' },
    ];
  });
  
  // Job Management state
  showJobModal = signal(false);
  jobToEdit: WritableSignal<Job | null> = signal(null);
  jobForm: FormGroup;
  
  // Team History state
  teamPayrollHistory = computed(() => {
    const teamUserIds = new Set(this.teamMembers().map(u => u.id));
    const currentUser = this.currentUser();
    if (currentUser) {
        teamUserIds.add(currentUser.id);
    }
    
    return this.dataService.publishedPayrolls()
      .filter(p => p.status === 'finalized')
      .map(p => {
        const teamReportData = p.reportData.filter(rd => {
            const user = this.dataService.users().find(u => u.techId === rd.techId);
            return user ? teamUserIds.has(user.id) : false;
        });
        
        if (teamReportData.length === 0) return null;

        return { ...p, reportData: teamReportData };
      })
      .filter((p): p is PublishedPayroll => p !== null);
  });

  selectedTeamPayrollId = signal<string | null>(null);

  selectedTeamPayroll = computed(() => {
      const id = this.selectedTeamPayrollId();
      if (!id) return null;
      return this.teamPayrollHistory().find(p => p.id === id) ?? null;
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

  selectTab(tab: SubAdminTab) {
    this.activeTab.set(tab);
  }

  selectTeamPayroll(payrollId: string) {
    this.selectedTeamPayrollId.set(payrollId);
  }

  getTechName(techId: string): string {
    return this.dataService.users().find(u => u.techId === techId)?.name || 'Unknown';
  }

  openEditJobModal(job: Job): void {
    this.jobToEdit.set(job);
    this.jobForm.patchValue(job);
    this.showJobModal.set(true);
  }

  closeJobModal(): void {
    this.showJobModal.set(false);
    this.jobToEdit.set(null);
  }

  saveJob(): void {
    if (this.jobForm.invalid) return;
    const editingJob = this.jobToEdit();
    if (!editingJob) return;

    this.dataService.updateJob({ ...editingJob, ...this.jobForm.getRawValue() });
    this.closeJobModal();
  }
  
  deleteJob(jobId: number): void {
    if (confirm('Are you sure you want to delete this job?')) {
      this.dataService.deleteJob(jobId);
    }
  }

  downloadExcel() {
    const data = this.teamProcessedTechnicians().map(tech => ({
      'Tech ID': tech.techId,
      'Name': tech.name,
      'Total Jobs': tech.totalJobs,
      'Total Revenue': tech.totalRevenue,
      'Adjustments': tech.adjustments.reduce((sum, adj) => sum + adj.amount, 0),
      'Final Payout': tech.totalEarnings,
      'Company Revenue': tech.companyRevenue,
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Team Report');
    XLSX.writeFile(workbook, `team_report_${this.currentUser()?.username}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  getAdjustmentsTotal(tech: ProcessedTechnician): number {
    return tech.adjustments.reduce((sum, adj) => sum + adj.amount, 0);
  }

  logout(): void {
    this.authService.logout();
  }
}