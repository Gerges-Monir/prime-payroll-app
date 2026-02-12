import { Component, ChangeDetectionStrategy, inject, computed, signal, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { DashboardHeaderComponent } from '../shared/dashboard-header/dashboard-header.component';
import { StatCardsComponent } from '../shared/stat-cards/stat-cards.component';
import { SidebarComponent } from '../shared/sidebar/sidebar.component';
import { User, Job, ProcessedTechnician, RateCategory, SubAdminPayrollBatch, StatCard, Rate } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';
import { TeamPaystubViewerComponent } from '../team-paystub-viewer/team-paystub-viewer.component';
import { PerformanceViewerComponent } from '../performance-viewer/performance-viewer.component';
import { CompanyPaystubViewerComponent } from '../company-paystub-viewer/company-paystub-viewer.component';
import { ChargebackHistoryComponent } from '../chargeback-history/chargeback-history.component';
import { SubAdminSettingsComponent } from '../sub-admin-settings/sub-admin-settings.component';
import { TaxFormsComponent } from '../tax-forms/tax-forms.component';

type SubAdminTab = 'dashboard' | 'manageBatch' | 'manageRates' | 'finalizedBatches' | 'teamPaystubs' | 'companyReport' | 'teamPerformance' | 'chargebackHistory' | 'settings' | '1099-forms';
type SortableField = 'techName' | 'workOrder' | 'date' | 'taskCode' | 'revenue';

type JobWithTechName = Job & { techName: string };

interface RateOverrideInfo {
  taskCode: string;
  companyRate: number;
  currentOverride: number | undefined;
  newOverride: WritableSignal<string>;
}

@Component({
  selector: 'app-sub-admin-dashboard',
  standalone: true,
  templateUrl: './sub-admin-dashboard.component.html',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    SidebarComponent,
    DashboardHeaderComponent,
    StatCardsComponent,
    ConfirmationModalComponent,
    TeamPaystubViewerComponent,
    PerformanceViewerComponent,
    CompanyPaystubViewerComponent,
    ChargebackHistoryComponent,
    SubAdminSettingsComponent,
    TaxFormsComponent,
  ],
})
export class SubAdminDashboardComponent {
  private dataService = inject(DatabaseService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  currentUser = computed(() => {
    const authUser = this.authService.currentUser();
    if (!authUser) return null;
    // Find the user from the live collection, fall back to the authUser if not found yet.
    return this.dataService.users().find(u => u.id === authUser.id) ?? authUser;
  });
  activeTab = signal<SubAdminTab>('dashboard');
  
  tabs: { id: SubAdminTab, name: string, icon: string }[] = [
    { id: 'dashboard', name: 'Dashboard', icon: 'dashboard' },
    { id: 'manageBatch', name: 'Current Payroll Batch', icon: 'jobs' },
    { id: 'manageRates', name: 'Manage Team Payouts', icon: 'rates' },
    { id: 'finalizedBatches', name: 'Finalized Batches', icon: 'history' },
    { id: 'teamPaystubs', name: 'Team Paystubs', icon: 'paystubs' },
    { id: 'companyReport', name: 'Company Report', icon: 'company' },
    { id: 'teamPerformance', name: 'Team Performance', icon: 'performance' },
    { id: '1099-forms', name: '1099 Forms', icon: 'tax' },
    { id: 'chargebackHistory', name: 'Chargeback History', icon: 'chargebacks' },
    { id: 'settings', name: 'Branding & Settings', icon: 'settings' },
  ];
  
  // Filter and Sort State
  filterTerm = signal('');
  selectedTechIdFilter = signal<string>('all');
  startDate = signal<string | null>(null);
  endDate = signal<string | null>(null);
  sortField = signal<SortableField>('date');
  sortDirection = signal<'asc' | 'desc'>('desc');
  
  teamMembers = computed(() => {
    const currentUser = this.currentUser();
    if (!currentUser) return [];
    const team = this.dataService.users().filter(u => u.assignedTo === currentUser.id);
    // Add self to the list to view own performance
    return [currentUser, ...team].sort((a, b) => a.name.localeCompare(b.name));
  });

  teamTechIds = computed(() => new Set(this.teamMembers().map(u => u.techId)));

  activeBatch = computed(() => {
    const subAdminId = this.currentUser()?.id;
    if (!subAdminId) return null;
    return this.dataService.subAdminBatches().find(b => b.subAdminId === subAdminId && b.status === 'pending') ?? null;
  });

  userMap = computed(() => new Map(this.dataService.users().map(u => [u.techId, u])));

  subAdminRateCategory = computed(() => {
    const subAdmin = this.currentUser();
    if (!subAdmin?.rateCategoryId) return null;
    return this.dataService.rateCategories().find(rc => rc.id === subAdmin.rateCategoryId) ?? null;
  });

  jobsWithSubAdminRevenue = computed(() => {
    const batch = this.activeBatch();
    if (!batch) return [];

    const rateCategory = this.subAdminRateCategory();
    const companyRates = rateCategory ? new Map<string, number>(rateCategory.rates.map(r => [r.taskCode, r.rate])) : new Map<string, number>();

    return (batch.jobs || []).map(job => {
        const companyRateForJob = companyRates.get(job.taskCode) ?? 0;
        const subAdminRevenue = companyRateForJob * job.quantity;
        return { ...job, revenue: subAdminRevenue };
    });
  });

  filteredAndSortedJobs = computed(() => {
    const batch = this.activeBatch();
    if (!batch) return [];
    
    const term = this.filterTerm().toLowerCase();
    const techIdFilter = this.selectedTechIdFilter();
    const start = this.startDate();
    const end = this.endDate();
    const field = this.sortField();
    const dir = this.sortDirection();
    const uMap = this.userMap();
    
    let jobs: JobWithTechName[] = this.jobsWithSubAdminRevenue().map(j => ({...j, techName: uMap.get(j.techId)?.name || 'Unknown' }));

    if (term) jobs = jobs.filter(j => j.techName.toLowerCase().includes(term) || j.workOrder.toLowerCase().includes(term) || j.taskCode.toLowerCase().includes(term));
    if (techIdFilter !== 'all') jobs = jobs.filter(j => j.techId === techIdFilter);
    if (start) jobs = jobs.filter(j => j.date >= start);
    if (end) jobs = jobs.filter(j => j.date <= end);
    
    return jobs.sort((a, b) => {
      let comparison = 0;
      switch (field) {
        case 'revenue':
          comparison = a.revenue - b.revenue;
          break;
        case 'techName':
          comparison = a.techName.localeCompare(b.techName);
          break;
        case 'workOrder':
          comparison = a.workOrder.localeCompare(b.workOrder);
          break;
        case 'date':
          comparison = a.date.localeCompare(b.date);
          break;
        case 'taskCode':
          comparison = a.taskCode.localeCompare(b.taskCode);
          break;
      }
      return dir === 'desc' ? -comparison : comparison;
    });
  });

  stats = computed<StatCard[]>(() => {
    const batch = this.activeBatch();
    const subAdmin = this.currentUser();
    if (!batch || !subAdmin) return [];

    const jobsForProcessing = this.jobsWithSubAdminRevenue();
    const report = this.dataService.processPayrollForJobs(jobsForProcessing, this.dataService.parseDateAsUTC(batch.startDate), this.dataService.parseDateAsUTC(batch.endDate));
    const myReport = report.find(r => r.id === subAdmin.id);
    const teamReports = report.filter(r => r.id !== subAdmin.id);

    const myEarnings = myReport?.totalEarnings ?? 0;
    const teamPayout = teamReports.reduce((sum, r) => sum + r.totalEarnings, 0);

    return [
      { label: 'My Earnings', value: myEarnings.toLocaleString('en-US', { style: 'currency', currency: 'USD' }), icon: 'revenue', color: 'green', description: 'Your personal job and profit earnings' },
      { label: 'Team Payout', value: teamPayout.toLocaleString('en-US', { style: 'currency', currency: 'USD' }), icon: 'users', color: 'blue', description: 'Total payout for your team members' },
      { label: 'Total Jobs in Batch', value: (jobsForProcessing.length).toString(), icon: 'jobs', color: 'orange', description: 'Jobs for you and your team' },
      { label: 'Team Profit', value: ((myReport?.totalEarnings ?? 0) - (myReport?.processedJobs.reduce((s,j)=>s+j.earning, 0) ?? 0)).toLocaleString('en-US', { style: 'currency', currency: 'USD' }), icon: 'company', color: 'purple', description: 'Your profit from team jobs' },
    ];
  });
  
  // Signals for finalized batches history
  finalizedBatches = computed(() => {
    const subAdminId = this.currentUser()?.id;
    if (!subAdminId) return [];
    return this.dataService.subAdminBatches()
      .filter(b => b.subAdminId === subAdminId && b.status === 'finalized')
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
  });

  selectedFinalizedBatchId = signal<string | null>(null);

  selectedFinalizedBatch = computed(() => {
    const id = this.selectedFinalizedBatchId();
    if (!id) return null;
    return this.finalizedBatches().find(b => b.id === id) ?? null;
  });

  selectedFinalizedBatchJobs = computed(() => {
    const batch = this.selectedFinalizedBatch();
    const rateCategory = this.subAdminRateCategory();
    if (!batch || !rateCategory) return [];
    
    const companyRates = new Map<string, number>(rateCategory.rates.map(r => [r.taskCode, r.rate]));
    const uMap = this.userMap();

    return (batch.jobs || [])
      .map(job => {
          const companyRateForJob = companyRates.get(job.taskCode) ?? 0;
          const subAdminRevenue = companyRateForJob * job.quantity;
          return {
              ...job, 
              revenue: subAdminRevenue,
              techName: uMap.get(job.techId)?.name || 'Unknown'
          };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });


  // Modal State
  showJobModal = signal(false);
  isSavingJob = signal(false);
  jobToEdit = signal<Job | null>(null);
  jobForm: FormGroup;
  
  showDeleteJobConfirm = signal(false);
  jobToDelete = signal<Job | null>(null);
  
  showTransferModal = signal(false);
  jobToTransfer = signal<Job | null>(null);
  transferToTechId = signal<string>('');
  isTransferring = signal(false);

  showFinalizeConfirm = signal(false);

  // Rate Management State
  selectedRateEmployeeId = signal<string | null>(null);

  subAdminCompanyTasks = computed<Rate[]>(() => {
    const category = this.subAdminRateCategory();
    if (!category) return [];
    return category.rates.sort((a,b) => a.taskCode.localeCompare(b.taskCode));
  });
  
  employeeRateOverrides = computed<RateOverrideInfo[]>(() => {
    const employeeId = this.selectedRateEmployeeId();
    if (!employeeId) return [];
    
    const employee = this.teamMembers().find(tm => tm.id === employeeId);
    if (!employee) return [];
    
    const companyTasks = this.subAdminCompanyTasks();
    const currentOverrides = new Map(employee.payoutOverrides?.map(o => [o.taskCode, o.rate]));

    return companyTasks.map(task => ({
        taskCode: task.taskCode,
        companyRate: task.rate,
        currentOverride: currentOverrides.get(task.taskCode), // number | undefined
        newOverride: signal(currentOverrides.get(task.taskCode)?.toString() ?? ''),
    }));
  });

  constructor() {
    this.fb = inject(FormBuilder);
    this.jobForm = this.fb.group({
      techId: [{value: '', disabled: true}, Validators.required],
      workOrder: [{value: '', disabled: true}],
      date: ['', Validators.required],
      taskCode: ['', Validators.required],
      revenue: ['', [Validators.required, Validators.min(0)]],
      quantity: [1, [Validators.required, Validators.min(0)]],
      rateOverride: [null as number | null],
    });
  }

  selectTab(tab: SubAdminTab) { this.activeTab.set(tab); }
  getTechName(techId: string): string { return this.userMap().get(techId)?.name || 'Unknown'; }
  logout(): void { this.authService.logout(); }
  
  openEditJobModal(job: Job) { 
    this.jobToEdit.set(job); 
    this.jobForm.patchValue({
      ...job,
      rateOverride: job.rateOverride ?? ''
    }); 
    this.showJobModal.set(true); 
  }
  closeJobModal() { this.showJobModal.set(false); this.jobToEdit.set(null); }

  async saveJob(): Promise<void> {
    if (this.jobForm.invalid) return;
    const editingJob = this.jobToEdit();
    const batch = this.activeBatch();
    if (!editingJob || !batch) return;

    this.isSavingJob.set(true);
    const formValue = this.jobForm.getRawValue();
    try {
        const rateOverrideValue = formValue.rateOverride;
        const rateOverride = (rateOverrideValue === '' || rateOverrideValue === null) ? undefined : Number(rateOverrideValue);

        const updatedJob: Job = {
          ...editingJob,
          date: formValue.date,
          taskCode: formValue.taskCode,
          revenue: Number(formValue.revenue),
          quantity: Number(formValue.quantity),
          rateOverride: rateOverride,
        };
        await this.dataService.updateSubAdminBatchJob(batch.id, updatedJob);
        this.notificationService.showSuccess('Job updated successfully.');
        this.closeJobModal();
    } catch(e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        this.notificationService.showError(errorMessage);
    } finally {
        this.isSavingJob.set(false);
    }
  }
  
  deleteJob(job: Job): void {
    this.jobToDelete.set(job);
    this.showDeleteJobConfirm.set(true);
  }

  async handleJobDelete(confirmed: boolean): Promise<void> {
    const job = this.jobToDelete();
    const batch = this.activeBatch();
    this.showDeleteJobConfirm.set(false);

    if (confirmed && job && batch) {
      try {
        await this.dataService.deleteSubAdminBatchJob(batch.id, job.id);
        this.notificationService.showSuccess('Job deleted from batch.');
      } catch (error) {
        this.notificationService.showError(error instanceof Error ? error.message : 'Failed to delete job.');
      }
    }
    this.jobToDelete.set(null);
  }

  openTransferModal(job: Job): void {
    this.jobToTransfer.set(job);
    this.transferToTechId.set('');
    this.showTransferModal.set(true);
  }
  
  closeTransferModal(): void {
    this.showTransferModal.set(false);
    this.jobToTransfer.set(null);
  }
  
  async confirmTransfer(): Promise<void> {
    const job = this.jobToTransfer();
    const newTechId = this.transferToTechId();
    const batch = this.activeBatch();

    if (!job || !newTechId || !batch) {
      this.notificationService.showError('Invalid transfer details.');
      return;
    }
    
    this.isTransferring.set(true);
    try {
      await this.dataService.transferSubAdminBatchJob(batch.id, job.id, newTechId);
      this.notificationService.showSuccess(`Job transferred successfully.`);
      this.closeTransferModal();
    } catch(e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.notificationService.showError(msg);
    } finally {
      this.isTransferring.set(false);
    }
  }

  finalizeBatch() {
    if (!this.activeBatch()) return;
    this.showFinalizeConfirm.set(true);
  }

  async handleFinalize(confirmed: boolean): Promise<void> {
    this.showFinalizeConfirm.set(false);
    const batch = this.activeBatch();
    if (confirmed && batch) {
      try {
        await this.dataService.finalizeSubAdminBatch(batch.id);
        this.notificationService.showSuccess('Payroll batch finalized and published for your team.');
        this.activeTab.set('teamPaystubs');
      } catch(e) {
        const msg = e instanceof Error ? e.message : 'Failed to finalize batch.';
        this.notificationService.showError(msg);
      }
    }
  }

  selectFinalizedBatch(batchId: string | null) {
    this.selectedFinalizedBatchId.set(batchId);
  }
  
  async applyPayoutOverride(taskCode: string, newRateStr: string): Promise<void> {
    const employeeId = this.selectedRateEmployeeId();
    const employee = this.teamMembers().find(tm => tm.id === employeeId);
    if (!employee) {
        this.notificationService.showError('No employee selected.');
        return;
    }

    const newOverrides = [...(employee.payoutOverrides || [])];
    const index = newOverrides.findIndex(o => o.taskCode === taskCode);

    if (newRateStr.trim() === '') {
        // If the input is empty, remove the override if it exists
        if (index > -1) {
            newOverrides.splice(index, 1);
        }
    } else {
        const newRate = parseFloat(newRateStr);
        if (isNaN(newRate)) {
            this.notificationService.showError('Invalid rate. Please enter a valid number.');
            return;
        }
        
        // If an override exists, update it. Otherwise, add a new one.
        if (index > -1) {
            newOverrides[index].rate = newRate;
        } else {
            newOverrides.push({ taskCode, rate: newRate });
        }
    }

    try {
        await this.dataService.updateUser({ ...employee, payoutOverrides: newOverrides });
        this.notificationService.showSuccess(`Payout for ${taskCode} updated for ${employee.name}.`);
    } catch (e) {
        this.notificationService.showError('Failed to save override.');
    }
  }
}