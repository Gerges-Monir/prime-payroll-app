import { Component, ChangeDetectionStrategy, inject, signal, computed, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { MockDataService } from '../../services/mock-data.service';
import { Job } from '../../models/payroll.model';

type SortableField = 'techName' | 'date' | 'taskCode' | 'revenue' | 'quantity';

@Component({
  selector: 'app-job-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './job-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobManagementComponent {
  private dataService = inject(MockDataService);
  private fb: FormBuilder;

  filterTerm = signal('');
  sortField = signal<SortableField>('date');
  sortDirection = signal<'asc' | 'desc'>('desc');

  showJobModal = signal(false);
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
    const field = this.sortField();
    const dir = this.sortDirection();
    const uMap = this.userMap();

    let jobs = this.dataService.jobs().map(job => ({...job, techName: uMap.get(job.techId) || 'Unknown' }));

    if (term) {
      jobs = jobs.filter(job => 
        job.techName.toLowerCase().includes(term) ||
        job.techId.toLowerCase().includes(term) ||
        job.taskCode.toLowerCase().includes(term)
      );
    }
    
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

  onFilter(event: Event) {
    const input = event.target as HTMLInputElement;
    this.filterTerm.set(input.value);
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

  saveJob(): void {
    if (this.jobForm.invalid) {
      return;
    }
    const editingJob = this.jobToEdit();
    if (!editingJob) return;

    const formValue = this.jobForm.getRawValue();

    this.dataService.updateJob({
      id: editingJob.id,
      techId: formValue.techId,
      date: formValue.date,
      taskCode: formValue.taskCode,
      revenue: Number(formValue.revenue),
      quantity: Number(formValue.quantity),
    });
    this.closeJobModal();
  }
  
  deleteJob(jobId: number, event: MouseEvent): void {
     event.stopPropagation();
    if (confirm('Are you sure you want to permanently delete this job? This will affect payroll calculations.')) {
      this.dataService.deleteJob(jobId);
    }
  }
}