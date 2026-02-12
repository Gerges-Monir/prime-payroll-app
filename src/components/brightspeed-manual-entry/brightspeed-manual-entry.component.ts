import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup, FormArray } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { Job, Rate, User } from '../../models/payroll.model';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-brightspeed-manual-entry',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe],
  templateUrl: './brightspeed-manual-entry.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrightspeedManualEntryComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  isSaving = signal(false);

  // Form setup
  entryForm: FormGroup;

  constructor() {
    this.fb = inject(FormBuilder);
    this.entryForm = this.fb.group({
      employeeId: ['', Validators.required],
      jobDate: [new Date().toISOString().split('T')[0], Validators.required],
      jobs: this.fb.array([]),
    });
    this.addJobRow(); // Start with one empty row
  }

  get jobsFormArray(): FormArray {
    return this.entryForm.get('jobs') as FormArray;
  }

  // Data from services
  employees = computed(() => this.dataService.users().filter(u => u.role === 'employee' || u.role === 'sub-admin' || u.role === 'supervisor').sort((a,b) => a.name.localeCompare(b.name)));
  
  private brightspeedRateCategory = computed(() => 
    this.dataService.rateCategories().find(c => c.name.toLowerCase() === 'brightspeed')
  );

  brightspeedTasks = computed<Rate[]>(() => {
    const category = this.brightspeedRateCategory();
    if (!category) return [];
    return category.rates.sort((a, b) => a.taskCode.localeCompare(b.taskCode));
  });

  addJobRow(): void {
    const jobGroup = this.fb.group({
      taskCode: ['', Validators.required],
      quantity: [1, [Validators.required, Validators.min(1)]],
      workOrder: ['', Validators.required],
    });
    this.jobsFormArray.push(jobGroup);
  }

  removeJobRow(index: number): void {
    this.jobsFormArray.removeAt(index);
  }

  async saveAllJobs(): Promise<void> {
    if (this.entryForm.invalid) {
      this.notificationService.showError('Please fill out all fields for each job row.');
      return;
    }

    this.isSaving.set(true);

    const formValue = this.entryForm.value;
    const selectedEmployee = this.employees().find(e => e.id === formValue.employeeId);
    if (!selectedEmployee) {
      this.notificationService.showError('Selected employee not found.');
      this.isSaving.set(false);
      return;
    }
    
    const companyRateMap = new Map(this.brightspeedTasks().map(t => [t.taskCode, t.rate]));
    const existingJobKeys = new Set(this.dataService.jobs().map(j => `${j.workOrder.trim().toLowerCase()}|${j.taskCode.trim().toLowerCase()}|${j.techId.trim().toLowerCase()}`));
    
    const jobsToAdd: Omit<Job, 'id'>[] = [];
    let skippedCount = 0;

    for (const job of formValue.jobs) {
      const key = `${String(job.workOrder).trim().toLowerCase()}|${String(job.taskCode).trim().toLowerCase()}|${selectedEmployee.techId.trim().toLowerCase()}`;
      if (existingJobKeys.has(key)) {
        skippedCount++;
        continue;
      }
      
      const companyRate = companyRateMap.get(job.taskCode) ?? 0;
      const revenue = companyRate * Number(job.quantity);

      jobsToAdd.push({
        techId: selectedEmployee.techId,
        date: formValue.jobDate,
        taskCode: job.taskCode,
        quantity: Number(job.quantity),
        workOrder: String(job.workOrder),
        revenue: revenue,
      });
    }

    if (jobsToAdd.length === 0 && skippedCount > 0) {
      this.notificationService.showError(`All ${skippedCount} entered jobs are duplicates of existing jobs. Nothing was saved.`);
      this.isSaving.set(false);
      return;
    }
    
    try {
      if (jobsToAdd.length > 0) {
        await this.dataService.addJobs(jobsToAdd);
      }
      
      let successMessage = `Successfully saved ${jobsToAdd.length} new jobs for ${selectedEmployee.name}.`;
      if (skippedCount > 0) {
        successMessage += ` Skipped ${skippedCount} duplicate jobs.`;
      }
      this.notificationService.showSuccess(successMessage);
      
      // Reset form
      this.jobsFormArray.clear();
      this.addJobRow();
      this.entryForm.markAsPristine();
      this.entryForm.markAsUntouched();

    } catch (e) {
      this.notificationService.showError(e instanceof Error ? e.message : 'An unexpected error occurred.');
    } finally {
      this.isSaving.set(false);
    }
  }
}
