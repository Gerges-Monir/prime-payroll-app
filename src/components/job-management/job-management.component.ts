import { Component, ChangeDetectionStrategy, inject, signal, computed, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup, FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { Job, Rate, User } from '../../models/payroll.model';
import { NotificationService } from '../../services/notification.service';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

type SortableField = 'techName' | 'workOrder' | 'date' | 'taskCode' | 'revenue' | 'quantity' | 'effectiveRate';

// Define an extended interface for jobs in the component
type JobWithDetails = Job & { 
  techName: string;
  effectiveRate: number | null;
  standardRate: number | null;
  warnings: string[];
  rateObject: Rate | null;
};

@Component({
  selector: 'app-job-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ConfirmationModalComponent, DatePipe, CurrencyPipe],
  templateUrl: './job-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobManagementComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;
  private currencyPipe: CurrencyPipe;

  // Filter and Sort State
  filterTerm = signal('');
  selectedTechIdFilter = signal<string>('all');
  taskCodeFilter = signal('');
  startDateInput = signal('');
  endDateInput = signal('');
  startDate = computed(() => this.formatDateToYyyyMmDd(this.startDateInput()));
  endDate = computed(() => this.formatDateToYyyyMmDd(this.endDateInput()));
  sortField = signal<SortableField>('date');
  sortDirection = signal<'asc' | 'desc'>('desc');
  showWarningsOnly = signal(false);

  // Modal State
  showJobModal = signal(false);
  isSavingJob = signal(false);
  jobToEdit: WritableSignal<JobWithDetails | null> = signal(null);
  jobForm: FormGroup;

  // Delete confirmation state
  showDeleteJobConfirm = signal(false);
  jobToDelete = signal<Job | null>(null);
  
  // Transfer state
  showTransferModal = signal(false);
  jobToTransfer = signal<Job | null>(null);
  transferToTechId = signal<string>('');
  isTransferring = signal(false);

  // NEW: Bulk action state
  selectedJobIds = signal<Set<string>>(new Set());
  showBulkDeleteConfirm = signal(false);
  showBulkTransferModal = signal(false);
  showBulkEditModal = signal(false);
  isBulkSaving = signal(false);
  bulkTransferToTechId = signal('');
  bulkEditForm: FormGroup;

  constructor() {
    this.fb = inject(FormBuilder);
    this.currencyPipe = inject(CurrencyPipe);
    this.jobForm = this.fb.group({
      techId: [{value: '', disabled: true}, Validators.required],
      workOrder: [{value: '', disabled: true}],
      date: ['', Validators.required],
      taskCode: ['', Validators.required],
      revenue: ['', [Validators.required, Validators.min(0)]],
      quantity: ['', [Validators.required, Validators.min(0)]],
      rateOverride: [null as number | null],
      isAerialDrop: [false],
    });

    this.bulkEditForm = this.fb.group({
      date: [''],
      rateOverride: [''],
      isAerialDrop: [''], // 'unset', 'set', or '' (leave unchanged)
    });
  }
  
  users = this.dataService.users;
  userMap = computed(() => new Map(this.users().map(u => [u.techId, u.name])));
  private rateCategories = this.dataService.rateCategories;
  
  employees = computed(() => this.users().filter(u => u.role === 'employee' || u.role === 'sub-admin' || u.role === 'supervisor').sort((a,b) => a.name.localeCompare(b.name)));

  transferableEmployees = computed(() => {
    const currentTechId = this.jobToTransfer()?.techId;
    return this.employees().filter(e => e.techId !== currentTechId);
  });

  possibleRates = computed(() => {
    const job = this.jobToEdit();
    if (!job) return [];
    
    const taskCode = job.taskCode;
    const allRateCategories = this.rateCategories();
    
    const rates = new Set<number>();
    
    // Add standard rate if it exists
    if (job.standardRate !== null) {
        rates.add(job.standardRate);
    }
    
    // Find all other rates for this task code
    allRateCategories.forEach(category => {
        category.rates.forEach(rate => {
            if (rate.taskCode === taskCode) {
                rates.add(rate.rate);
            }
        });
    });
    
    return Array.from(rates).sort((a,b) => a - b).map(rate => ({
        value: rate,
        label: `${this.currencyPipe.transform(rate)} ${rate === job.standardRate ? '(Standard)' : ''}`.trim()
    }));
  });

  filteredAndSortedJobs = computed(() => {
    const term = this.filterTerm().toLowerCase();
    const techIdFilter = this.selectedTechIdFilter();
    const taskCodeTerm = this.taskCodeFilter().toLowerCase();
    const start = this.startDate();
    const end = this.endDate();
    const field = this.sortField();
    const dir = this.sortDirection();
    const uMap = this.userMap();
    const users = this.users();
    const rateCategories = this.rateCategories();
    const warningsOnly = this.showWarningsOnly();

    const getRateObject = (job: Job): Rate | null => {
        const user = users.find(u => u.techId === job.techId);
        if (!user || user.rateCategoryId === undefined || user.rateCategoryId === null) return null;
        const category = rateCategories.find(c => c.id === user.rateCategoryId);
        if (!category) return null;
        const rate = category.rates.find(r => r.taskCode === job.taskCode);
        return rate || null;
    }

    let jobs: JobWithDetails[] = this.dataService.jobs().map(job => {
        const rateObject = getRateObject(job);
        const standardRate = rateObject?.rate ?? null;
        const effectiveRate = job.rateOverride ?? standardRate;
        const warnings: string[] = [];
        if (job.revenue === 0) {
            warnings.push('Job has zero revenue.');
        }
        if (effectiveRate === null) {
            warnings.push('No standard rate found and no override is set.');
        }

        return {
            ...job,
            techName: uMap.get(job.techId) || 'Unknown',
            effectiveRate,
            standardRate: standardRate,
            rateObject,
            warnings,
        }
    });
    
    // Apply warnings filter first
    if (warningsOnly) {
      jobs = jobs.filter(job => job.warnings.length > 0);
    }

    // Apply text filter
    if (term) {
      jobs = jobs.filter(job => 
        job.techName.toLowerCase().includes(term) ||
        job.techId.toLowerCase().includes(term) ||
        job.workOrder.toLowerCase().includes(term)
      );
    }

    // Apply task code filter
    if (taskCodeTerm) {
        jobs = jobs.filter(job => job.taskCode.toLowerCase().includes(taskCodeTerm));
    }

    // Apply tech filter
    if (techIdFilter !== 'all') {
        jobs = jobs.filter(job => job.techId === techIdFilter);
    }

    // Apply date range filter
    if (start) {
        jobs = jobs.filter(job => job.date >= start);
    }
    if (end) {
        jobs = jobs.filter(job => job.date <= end);
    }
    
    // Apply sort
    return jobs.sort((a, b) => {
      let comparison = 0;
      const dirMultiplier = dir === 'desc' ? -1 : 1;

      switch (field) {
        case 'revenue':
          comparison = (a.revenue || 0) - (b.revenue || 0);
          break;
        case 'quantity':
          comparison = (a.quantity || 0) - (b.quantity || 0);
          break;
        case 'effectiveRate':
          comparison = (a.effectiveRate ?? -1) - (b.effectiveRate ?? -1);
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

      return comparison * dirMultiplier;
    });
  });

  areAllFilteredJobsSelected = computed(() => {
    const filtered = this.filteredAndSortedJobs();
    const selected = this.selectedJobIds();
    return filtered.length > 0 && filtered.every(j => selected.has(j.id));
  });

  onFilter(event: Event) { this.filterTerm.set((event.target as HTMLInputElement).value); }
  onTaskCodeFilter(event: Event) { this.taskCodeFilter.set((event.target as HTMLInputElement).value); }
  onTechFilterChange(event: Event) { this.selectedTechIdFilter.set((event.target as HTMLSelectElement).value); }
  onStartDate(event: Event) { this.startDateInput.set((event.target as HTMLInputElement).value); }
  onEndDate(event: Event) { this.endDateInput.set((event.target as HTMLInputElement).value); }
  
  toggleShowWarningsOnly(event: Event) {
    this.showWarningsOnly.set((event.target as HTMLInputElement).checked);
  }

  setQuickFilter(period: 'today' | 'week' | 'month') {
    const today = new Date();
    const toInputDate = (d: Date) => {
        const pad = (num: number) => (num < 10 ? '0' : '') + num;
        return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(-2)}`;
    }
    
    this.endDateInput.set(toInputDate(today));

    if (period === 'today') {
        this.startDateInput.set(toInputDate(today));
    } else if (period === 'week') {
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        this.startDateInput.set(toInputDate(startOfWeek));
    } else if (period === 'month') {
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        this.startDateInput.set(toInputDate(startOfMonth));
    }
  }

  setSort(field: SortableField) {
    if (this.sortField() === field) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('asc');
    }
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

  openEditJobModal(job: JobWithDetails): void {
    this.jobToEdit.set(job);
    this.jobForm.patchValue({
      ...job,
      date: this.formatDateToMmDdYy(job.date),
      rateOverride: job.rateOverride ?? '',
      isAerialDrop: job.isAerialDrop ?? false,
    });
    this.showJobModal.set(true);
  }

  closeJobModal(): void {
    this.showJobModal.set(false);
    this.jobToEdit.set(null);
  }

  async saveJob(): Promise<void> {
    if (this.jobForm.invalid) return;
    
    const editingJob = this.jobToEdit();
    if (!editingJob) return;

    this.isSavingJob.set(true);
    const formValue = this.jobForm.getRawValue();

    try {
      const formattedDate = this.formatDateToYyyyMmDd(formValue.date);
      if (!formattedDate) {
          this.notificationService.showError('Invalid date format. Please use MM/DD/YY.');
          this.isSavingJob.set(false);
          return;
      }
      const rateOverrideValue = formValue.rateOverride;
      const rateOverride = (rateOverrideValue === '' || rateOverrideValue === null) 
        ? undefined 
        : Number(rateOverrideValue);

      await this.dataService.updateJob({
        id: editingJob.id,
        techId: editingJob.techId,
        workOrder: editingJob.workOrder,
        date: formattedDate,
        taskCode: formValue.taskCode,
        revenue: Number(formValue.revenue),
        quantity: Number(formValue.quantity),
        rateOverride: rateOverride,
        isAerialDrop: formValue.isAerialDrop,
      });
      this.notificationService.showSuccess('Job updated successfully.');
      this.closeJobModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.notificationService.showError(msg);
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
    this.showDeleteJobConfirm.set(false);

    if (confirmed && job) {
      try {
        await this.dataService.deleteJob(job.id);
        this.notificationService.showSuccess('Job deleted successfully.');
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

    if (!job || !newTechId) {
      this.notificationService.showError('Please select a valid employee to transfer the job to.');
      return;
    }
    
    this.isTransferring.set(true);
    try {
      await this.dataService.transferJob(job.id, newTechId);
      const newOwner = this.userMap().get(newTechId);
      this.notificationService.showSuccess(`Job transferred successfully to ${newOwner}.`);
      this.closeTransferModal();
    } catch(e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.notificationService.showError(msg);
    } finally {
      this.isTransferring.set(false);
    }
  }

  async toggleAerialDrop(job: JobWithDetails) {
    const turningOn = !job.isAerialDrop;

    if (turningOn) {
        const user = this.users().find(u => u.techId === job.techId);
        if (!user || !user.rateCategoryId) {
            this.notificationService.showError(`Cannot find rate category for technician.`);
            return;
        }
        const category = this.rateCategories().find(c => c.id === user.rateCategoryId);
        if (!category) {
            this.notificationService.showError(`Rate category not found.`);
            return;
        }

        const aerialDropRate = category.rates.find(r => r.taskCode === 'FTTH Aerial Drop Install');
        const payout = aerialDropRate ? aerialDropRate.rate : 0;

        if (payout === 0) {
            this.notificationService.show("Aerial drop payout task 'FTTH Aerial Drop Install' not found in this technician's rate category. Rate not changed.", 'info');
            return;
        }

        if (job.standardRate === null) {
            this.notificationService.showError(`Cannot add aerial drop: Standard rate for '${job.taskCode}' not found for this technician.`);
            return;
        }

        const newRate = job.standardRate + payout;
        
        const updatedJob: Job = { 
            id: job.id, workOrder: job.workOrder, techId: job.techId,
            taskCode: job.taskCode, revenue: job.revenue, quantity: job.quantity,
            date: job.date, rateOverride: newRate, isAerialDrop: true,
        };
        
        try {
            await this.dataService.updateJob(updatedJob);
            this.notificationService.showSuccess(`Aerial drop added. Rate updated to ${this.currencyPipe.transform(newRate)}.`);
        } catch (e) {
            this.notificationService.showError('Failed to update job.');
        }

    } else {
        // Turning OFF
        const updatedJob: Job = { 
            id: job.id, workOrder: job.workOrder, techId: job.techId,
            taskCode: job.taskCode, revenue: job.revenue, quantity: job.quantity,
            date: job.date, rateOverride: undefined, isAerialDrop: false,
        };
        try {
            await this.dataService.updateJob(updatedJob);
            this.notificationService.showSuccess(`Aerial drop removed. Rate reverted to standard.`);
        } catch (e) {
            this.notificationService.showError('Failed to update job.');
        }
    }
  }

  onAerialDropToggleInModal(event: Event): void {
    const isChecked = (event.target as HTMLInputElement).checked;
    const job = this.jobToEdit();
    if (!job) return;

    if (isChecked) {
        const user = this.users().find(u => u.techId === job.techId);
        if (!user || !user.rateCategoryId) {
            this.notificationService.showError(`Cannot find rate category for technician.`);
            this.jobForm.get('isAerialDrop')?.setValue(false, { emitEvent: false });
            return;
        }
        const category = this.rateCategories().find(c => c.id === user.rateCategoryId);
        if (!category) {
            this.notificationService.showError(`Rate category not found.`);
            this.jobForm.get('isAerialDrop')?.setValue(false, { emitEvent: false });
            return;
        }
        const aerialDropRate = category.rates.find(r => r.taskCode === 'FTTH Aerial Drop Install');
        const payout = aerialDropRate ? aerialDropRate.rate : 0;

        if (payout === 0) {
            this.notificationService.showError("Aerial drop payout task 'FTTH Aerial Drop Install' not found in this technician's rate category.");
            this.jobForm.get('isAerialDrop')?.setValue(false, { emitEvent: false });
            return;
        }
        if (job.standardRate === null) {
            this.notificationService.showError(`Cannot add aerial drop: Standard rate for '${job.taskCode}' not found.`);
            this.jobForm.get('isAerialDrop')?.setValue(false, { emitEvent: false });
            return;
        }
        const newRate = job.standardRate + payout;
        this.jobForm.get('rateOverride')?.setValue(newRate.toFixed(2));
    } else {
        // When unchecking, clear the override to revert to standard rate.
        this.jobForm.get('rateOverride')?.setValue('');
    }
  }

  // --- BULK ACTION METHODS ---

  clearSelection(): void {
    this.selectedJobIds.set(new Set());
  }

  toggleJobSelection(jobId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedJobIds.update(currentSet => {
      if (input.checked) {
        currentSet.add(jobId);
      } else {
        currentSet.delete(jobId);
      }
      return new Set(currentSet);
    });
  }

  toggleSelectAll(event: Event): void {
    const isChecked = (event.target as HTMLInputElement).checked;
    const filteredIds = this.filteredAndSortedJobs().map(j => j.id);

    this.selectedJobIds.update(currentSet => {
      if (isChecked) {
        filteredIds.forEach(id => currentSet.add(id));
      } else {
        filteredIds.forEach(id => currentSet.delete(id));
      }
      return new Set(currentSet);
    });
  }

  triggerBulkDelete(): void {
    if (this.selectedJobIds().size === 0) return;
    this.showBulkDeleteConfirm.set(true);
  }

  async handleBulkDelete(confirmed: boolean): Promise<void> {
    this.showBulkDeleteConfirm.set(false);
    if (!confirmed) return;

    const idsToDelete = Array.from(this.selectedJobIds());
    this.isBulkSaving.set(true);
    try {
      await this.dataService.deleteJobs(idsToDelete);
      this.notificationService.showSuccess(`Successfully deleted ${idsToDelete.length} jobs.`);
      this.selectedJobIds.set(new Set());
    } catch (e) {
      this.notificationService.showError('Failed to delete selected jobs.');
    } finally {
      this.isBulkSaving.set(false);
    }
  }

  triggerBulkTransfer(): void {
    if (this.selectedJobIds().size === 0) return;
    this.bulkTransferToTechId.set('');
    this.showBulkTransferModal.set(true);
  }
  
  async confirmBulkTransfer(): Promise<void> {
    const newTechId = this.bulkTransferToTechId();
    if (!newTechId) {
      this.notificationService.showError('Please select an employee.');
      return;
    }
    const idsToTransfer = Array.from(this.selectedJobIds());
    this.isBulkSaving.set(true);
    try {
      await this.dataService.transferJobs(idsToTransfer, newTechId);
      this.notificationService.showSuccess(`${idsToTransfer.length} jobs transferred to ${this.userMap().get(newTechId)}.`);
      this.selectedJobIds.set(new Set());
      this.showBulkTransferModal.set(false);
    } catch (e) {
      this.notificationService.showError('Failed to transfer jobs.');
    } finally {
      this.isBulkSaving.set(false);
    }
  }

  triggerBulkEdit(): void {
    if (this.selectedJobIds().size === 0) return;
    this.bulkEditForm.reset({ date: '', rateOverride: '', isAerialDrop: '' });
    this.showBulkEditModal.set(true);
  }

  async saveBulkEdit(): Promise<void> {
    this.isBulkSaving.set(true);
    const formValue = this.bulkEditForm.value;
    const idsToUpdate = Array.from(this.selectedJobIds());
    const promises: Promise<any>[] = [];

    // Handle aerial drop as a separate, complex operation
    if (formValue.isAerialDrop) {
        const status = formValue.isAerialDrop === 'set';
        promises.push(this.dataService.bulkSetAerialDrop(idsToUpdate, status));
    }

    // Handle other simple updates
    const simpleUpdates: Partial<Omit<Job, 'id'>> = {};
    if (formValue.date) {
        const formattedDate = this.formatDateToYyyyMmDd(formValue.date);
        if (formattedDate) {
            simpleUpdates.date = formattedDate;
        } else {
            this.notificationService.showError('The date format is invalid. Please use MM/DD/YY.');
            this.isBulkSaving.set(false);
            return;
        }
    }
    if (formValue.rateOverride !== null && formValue.rateOverride !== '') {
        simpleUpdates.rateOverride = Number(formValue.rateOverride);
    } else if (formValue.rateOverride === '') {
        simpleUpdates.rateOverride = undefined;
    }

    if (Object.keys(simpleUpdates).length > 0) {
        promises.push(this.dataService.bulkUpdateJobs(idsToUpdate, simpleUpdates));
    }
    
    if (promises.length === 0) {
        this.notificationService.showError('No changes were entered to apply.');
        this.isBulkSaving.set(false);
        return;
    }

    try {
        await Promise.all(promises);
        this.notificationService.showSuccess(`${idsToUpdate.length} jobs updated successfully.`);
        this.selectedJobIds.set(new Set());
        this.showBulkEditModal.set(false);
    } catch (e) {
        this.notificationService.showError('Failed to update jobs.');
    } finally {
      this.isBulkSaving.set(false);
    }
  }
}