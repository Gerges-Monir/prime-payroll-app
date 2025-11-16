import { Component, ChangeDetectionStrategy, inject, signal, computed, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { Job } from '../../models/payroll.model';
import { NotificationService } from '../../services/notification.service';

type SortableField = 'techName' | 'date' | 'taskCode' | 'revenue' | 'quantity';

@Component({
  selector: 'app-job-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './job-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobManagementComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  // Filter and Sort State
  filterTerm = signal('');
  startDate = signal<string | null>(null);
  endDate = signal<string | null>(null);
  sortField = signal<SortableField>('date');
  sortDirection = signal<'asc' | 'desc'>('desc');

  // Modal State
  showJobModal = signal(false);
  isSavingJob = signal(false);
  jobToEdit: WritableSignal<Job | null> = signal(null);
  jobForm: FormGroup;

  constructor() {
    this.fb = inject(FormBuilder);
    this.jobForm = this.fb.group({
      techId: [{value: '', disabled: true}, Validators.required],
      date: ['', Validators.required],
      taskCode: ['', Validators.required],
      revenue: ['', [Validators.required, Validators.min(0)]],
      quantity: ['', [Validators.required, Validators.min(0)]],
    });
  }
  
  users = this.dataService.users;
  userMap = computed(() => new Map(this.users().map(u => [u.techId, u.name])));

  filteredAndSortedJobs = computed(() => {
    const term = this.filterTerm().toLowerCase();
    const start = this.startDate();
    const end = this.endDate();
    const field = this.sortField();
    const dir = this.sortDirection();
    const uMap = this.userMap();

    let jobs = this.dataService.jobs().map(job => ({...job, techName: uMap.get(job.techId) || 'Unknown' }));

    // Apply text filter
    if (term) {
      jobs = jobs.filter(job => 
        job.techName.toLowerCase().includes(term) ||
        job.techId.toLowerCase().includes(term) ||
        job.taskCode.toLowerCase().includes(term)
      );
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
      const valA = a[field];
      const valB = b[field];
      
      let comparison = 0;
      if (valA > valB) {
        comparison = 1;
      } else if (valA < valB) {
        comparison = -1;
      }
      return dir === 'desc' ? comparison * -1 : comparison;
    });
  });

  onFilter(event: Event) { this.filterTerm.set((event.target as HTMLInputElement).value); }
  onStartDate(event: Event) { this.startDate.set((event.target as HTMLInputElement).value || null); }
  onEndDate(event: Event) { this.endDate.set((event.target as HTMLInputElement).value || null); }

  setQuickFilter(period: 'today' | 'week' | 'month') {
    const today = new Date();
    const toISODate = (d: Date) => {
      const pad = (num: number) => (num < 10 ? '0' : '') + num;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    
    this.endDate.set(toISODate(today));

    if (period === 'today') {
        this.startDate.set(toISODate(today));
    } else if (period === 'week') {
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        this.startDate.set(toISODate(startOfWeek));
    } else if (period === 'month') {
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        this.startDate.set(toISODate(startOfMonth));
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

  openEditJobModal(job: Job): void {
    this.jobToEdit.set(job);
    this.jobForm.patchValue(job);
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
      await this.dataService.updateJob({
        id: editingJob.id,
        techId: editingJob.techId,
        date: formValue.date,
        taskCode: formValue.taskCode,
        revenue: Number(formValue.revenue),
        quantity: Number(formValue.quantity),
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
  
  async deleteJob(jobId: number): Promise<void> {
    if (confirm('Are you sure you want to permanently delete this job?')) {
      await this.dataService.deleteJob(jobId);
      this.notificationService.showSuccess('Job deleted successfully.');
    }
  }
}