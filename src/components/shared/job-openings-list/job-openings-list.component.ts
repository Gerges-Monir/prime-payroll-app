import { Component, ChangeDetectionStrategy, input, output, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { JobOpening } from '../../../models/payroll.model';

@Component({
  selector: 'app-job-openings-list',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './job-openings-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobOpeningsListComponent {
  jobOpenings = input.required<JobOpening[]>();
  close = output<void>();
  applyForJob = output<JobOpening>();

  selectedJob = signal<JobOpening | null>(null);

  selectedJobRequirements = computed(() => {
    const job = this.selectedJob();
    if (!job) return [];
    return job.requirements.split('\n').filter(r => r.trim() !== '');
  });

  onApply(job: JobOpening) {
    this.applyForJob.emit(job);
  }
}
