import { Component, ChangeDetectionStrategy, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { SmtpService } from '../../../services/smtp.service';
import { NotificationService } from '../../../services/notification.service';

@Component({
  selector: 'app-contact-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './contact-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactFormComponent {
  private fb: FormBuilder;
  private smtpService = inject(SmtpService);
  private notificationService = inject(NotificationService);

  close = output<void>();

  contactForm: FormGroup;
  isSending = signal(false);

  constructor() {
    this.fb = inject(FormBuilder);
    this.contactForm = this.fb.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      subject: ['', Validators.required],
      message: ['', Validators.required],
    });
  }

  async onSubmit() {
    if (this.contactForm.invalid) {
      this.notificationService.showError('Please fill out all fields correctly.');
      return;
    }

    this.isSending.set(true);
    const { name, email, subject, message } = this.contactForm.value;
    
    const success = await this.smtpService.sendContactMessage(name, email, subject, message);

    if (success) {
      this.contactForm.reset();
      this.close.emit();
    }
    
    this.isSending.set(false);
  }
}
