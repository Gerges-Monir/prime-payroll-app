import { Component, ChangeDetectionStrategy, inject, signal, output, input, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { SmtpService } from '../../../services/smtp.service';
import { DatabaseService } from '../../../services/database.service';
import { NotificationService } from '../../../services/notification.service';
import { JobOpening } from '../../../models/payroll.model';

@Component({
  selector: 'app-career-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './career-form.component.html',
  styleUrls: ['./career-form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block flex-grow min-h-0 overflow-y-auto'
  }
})
export class CareerFormComponent {
  private fb: FormBuilder;
  private smtpService = inject(SmtpService);
  private databaseService = inject(DatabaseService);
  private notificationService = inject(NotificationService);

  close = output<void>();
  jobOpening = input<JobOpening | null>(null);
  allJobOpenings = input<JobOpening[]>([]); // Note: This is no longer used but kept for component signature stability
  isPreview = input<boolean>(false);

  careerForm: FormGroup;
  isSending = signal(false);
  selectedFileName = signal<string | null>(null);
  
  submissionState = signal<'form' | 'success'>('form');
  currentStep = signal(1);
  
  totalSteps = computed(() => (this.jobOpening()?.customQuestions?.length ?? 0) > 0 ? 3 : 2);

  get customAnswers(): FormArray {
    return this.careerForm.get('customAnswers') as FormArray;
  }

  constructor() {
    this.fb = inject(FormBuilder);
    this.careerForm = this.fb.group({
      // Step 1
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', Validators.required],
      position: ['', Validators.required],
      // Step 2
      hasDriversLicense: [null, Validators.required],
      willingToTravel: [null, Validators.required],
      isFluentInEnglish: [null, Validators.required],
      resumeLink: [''],
      resume: [null],
      // Step 3 (Dynamic)
      customAnswers: this.fb.array([]),
    });

    effect(() => {
      const job = this.jobOpening();
      const isPreviewing = this.isPreview();
      const customAnswersArray = this.careerForm.get('customAnswers') as FormArray;

      // Reset form state before populating
      this.careerForm.reset();
      customAnswersArray.clear();
      
      // Populate form based on jobOpening
      if (job) {
        const jobData = job as JobOpening;
        this.careerForm.patchValue({ position: jobData.title });

        if (jobData.customQuestions) {
          jobData.customQuestions.forEach(question => {
            customAnswersArray.push(this.fb.group({
              question: [question],
              answer: ['', Validators.required]
            }));
          });
        }
      }

      // Handle form state (enabled/disabled)
      if (isPreviewing) {
        this.careerForm.disable();
      } else {
        this.careerForm.enable();
        // The position is readonly in the template, so we don't need to disable it here.
        // It needs to be enabled for its value and validity to be part of the form group.
        if (this.careerForm.get('position')) {
          // Re-enable if it was disabled by a previous preview state
          this.careerForm.get('position')?.enable(); 
        }
      }
    });
  }

  nextStep(): void {
    if (this.isPreview() || this.isStepValid(this.currentStep())) {
      if (this.currentStep() < this.totalSteps()) {
        this.currentStep.update(s => s + 1);
      }
    } else {
      this.notificationService.showError('Please fill out all required fields for this step.');
      this.markStepAsTouched(this.currentStep());
    }
  }

  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
    }
  }

  isStepValid(step: number): boolean {
    if (step === 1) {
      return !!this.careerForm.get('name')?.valid && !!this.careerForm.get('email')?.valid && !!this.careerForm.get('phone')?.valid && !!this.careerForm.get('position')?.valid;
    }
    if (step === 2) {
      return !!this.careerForm.get('hasDriversLicense')?.valid && !!this.careerForm.get('willingToTravel')?.valid && !!this.careerForm.get('isFluentInEnglish')?.valid;
    }
    if (step === 3) {
      return !!this.careerForm.get('customAnswers')?.valid;
    }
    return false;
  }

  markStepAsTouched(step: number): void {
    const controls: string[] = [];
    if (step === 1) controls.push('name', 'email', 'phone', 'position');
    if (step === 2) controls.push('hasDriversLicense', 'willingToTravel', 'isFluentInEnglish');
    if (step === 3) {
      this.customAnswers.controls.forEach(control => {
          (control as FormGroup).controls['answer'].markAsTouched();
      });
    }
    
    controls.forEach(controlName => {
      this.careerForm.get(controlName)?.markAsTouched();
      this.careerForm.get(controlName)?.updateValueAndValidity();
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (file.size > 2 * 1024 * 1024) { // 2MB limit
        this.notificationService.showError('Resume file must be smaller than 2MB.');
        this.selectedFileName.set(null);
        this.careerForm.get('resume')?.reset();
        return;
      }
      this.selectedFileName.set(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        this.careerForm.patchValue({
          resume: {
            fileName: file.name,
            fileType: file.type,
            dataUrl: reader.result as string,
          }
        });
      };
      reader.readAsDataURL(file);
    } else {
      this.selectedFileName.set(null);
      this.careerForm.get('resume')?.reset();
    }
  }

  async onSubmit() {
    if (this.careerForm.invalid) {
      this.notificationService.showError('Please complete all steps of the application.');
      this.markStepAsTouched(1);
      this.markStepAsTouched(2);
      if (this.totalSteps() === 3) {
        this.markStepAsTouched(3);
      }
      return;
    }

    this.isSending.set(true);
    const formValue = this.careerForm.getRawValue();

    const applicationData = {
      ...formValue,
      submissionDate: new Date().toISOString(),
      hasDriversLicense: !!formValue.hasDriversLicense,
      willingToTravel: !!formValue.willingToTravel,
      isFluentInEnglish: !!formValue.isFluentInEnglish,
    };

    try {
      await this.databaseService.addCareerApplication(applicationData);
      this.submissionState.set('success');
      const emailSent = await this.smtpService.sendCareerApplication(applicationData);
      if (!emailSent) {
          this.notificationService.show('Application saved, but notification email could not be sent.', 'info', 8000);
      }
    } catch (error) {
      console.error('Application Submission Error:', error);
      this.notificationService.showError('There was a problem saving your application. Please try again.');
    } finally {
        this.isSending.set(false);
    }
  }
  
  handleClose(): void {
    if (this.submissionState() === 'success') {
      this.submissionState.set('form');
      this.currentStep.set(1);
      this.careerForm.reset();
      this.selectedFileName.set(null);
    }
    this.close.emit();
  }
}
