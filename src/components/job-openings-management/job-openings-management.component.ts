import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { NotificationService } from '../../services/notification.service';
import { JobOpening } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';
import { CareerFormComponent } from '../shared/career-form/career-form.component';

@Component({
  selector: 'app-job-openings-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ConfirmationModalComponent, DatePipe, CareerFormComponent],
  templateUrl: './job-openings-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobOpeningsManagementComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  jobOpenings = computed(() => 
    this.dataService.jobOpenings().sort((a, b) => new Date(b.datePosted).getTime() - new Date(a.datePosted).getTime())
  );

  showModal = signal(false);
  isSaving = signal(false);
  jobToEdit = signal<JobOpening | null>(null);
  
  showDeleteConfirm = signal(false);
  jobToDelete = signal<JobOpening | null>(null);

  // New signals for preview
  showPreviewModal = signal(false);
  jobToPreview = signal<JobOpening | null>(null);

  jobOpeningForm: FormGroup;

  constructor() {
    this.fb = inject(FormBuilder);
    this.jobOpeningForm = this.fb.group({
      title: ['', Validators.required],
      description: ['', Validators.required],
      requirements: ['', Validators.required],
      isActive: [true],
      customQuestions: this.fb.array([]),
    });
  }

  get customQuestions(): FormArray {
    return this.jobOpeningForm.get('customQuestions') as FormArray;
  }

  addQuestion(): void {
    this.customQuestions.push(this.fb.control('', Validators.required));
  }

  removeQuestion(index: number): void {
    this.customQuestions.removeAt(index);
  }

  openModal(job?: JobOpening): void {
    this.customQuestions.clear();
    if (job) {
      this.jobToEdit.set(job);
      this.jobOpeningForm.patchValue(job);
      if (job.customQuestions) {
        job.customQuestions.forEach(q => this.customQuestions.push(this.fb.control(q, Validators.required)));
      }
    } else {
      this.jobToEdit.set(null);
      this.jobOpeningForm.reset({ isActive: true });
    }
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  openPreviewModal(job: JobOpening): void {
    this.jobToPreview.set(job);
    this.showPreviewModal.set(true);
  }

  closePreviewModal(): void {
    this.showPreviewModal.set(false);
  }

  async saveJobOpening(): Promise<void> {
    if (this.jobOpeningForm.invalid) {
      this.notificationService.showError('Please fill out all required fields.');
      return;
    }

    this.isSaving.set(true);
    const formValue = this.jobOpeningForm.value;
    const editingJob = this.jobToEdit();

    try {
      if (editingJob) {
        const updatedJob: JobOpening = { ...editingJob, ...formValue };
        await this.dataService.updateJobOpening(updatedJob);
        this.notificationService.showSuccess(`Job opening "${updatedJob.title}" updated.`);
      } else {
        const newJob: Omit<JobOpening, 'id'> = {
          ...formValue,
          datePosted: new Date().toISOString(),
        };
        await this.dataService.addJobOpening(newJob);
        this.notificationService.showSuccess(`Job opening "${newJob.title}" created.`);
      }
      this.closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      this.notificationService.showError(message);
    } finally {
      this.isSaving.set(false);
    }
  }

  deleteJobOpening(job: JobOpening): void {
    this.jobToDelete.set(job);
    this.showDeleteConfirm.set(true);
  }

  async handleDelete(confirmed: boolean): Promise<void> {
    const job = this.jobToDelete();
    this.showDeleteConfirm.set(false);
    if (confirmed && job) {
      try {
        await this.dataService.deleteJobOpening(job.id);
        this.notificationService.showSuccess(`Job opening "${job.title}" deleted.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete job opening.';
        this.notificationService.showError(message);
      }
    }
    this.jobToDelete.set(null);
  }
}