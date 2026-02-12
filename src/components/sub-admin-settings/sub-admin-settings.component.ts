import { Component, ChangeDetectionStrategy, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { NotificationService } from '../../services/notification.service';
import { DatabaseService } from '../../services/database.service';
import { AuthService } from '../../services/auth.service';
import { SubAdminSettings } from '../../models/payroll.model';

@Component({
  selector: 'app-sub-admin-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './sub-admin-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubAdminSettingsComponent implements OnInit {
  private dataService = inject(DatabaseService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;
  
  private currentUser = this.authService.currentUser;
  
  settings = computed<Partial<SubAdminSettings>>(() => {
    const userId = this.currentUser()?.id;
    if (!userId) return {};
    return this.dataService.subAdminSettings().find(s => s.subAdminId === userId) || {};
  });

  logoUrl = computed(() => this.settings().logoUrl || 'https://via.placeholder.com/300x75.png?text=Upload+Logo');
  
  uploadMessage = signal('');
  uploadError = signal(false);

  settingsForm: FormGroup;

  constructor() {
    this.fb = inject(FormBuilder);
    this.settingsForm = this.fb.group({
      companyName: [''],
      companyAddress1: [''],
      companyAddress2: [''],
      companyEmail: ['', Validators.email],
      companyPhone: [''],
    });
  }

  ngOnInit(): void {
    this.settingsForm.patchValue(this.settings());
  }

  saveSettings(): void {
    if (this.settingsForm.invalid) {
      this.notificationService.showError('Please correct the errors before saving.');
      return;
    }
    const userId = this.currentUser()?.id;
    if (!userId) {
        this.notificationService.showError('Could not identify current user.');
        return;
    }

    const settingsToSave: Omit<SubAdminSettings, 'id'> = {
        subAdminId: userId,
        ...this.settings(),
        ...this.settingsForm.value
    };

    this.dataService.updateSubAdminSettings(settingsToSave);
    this.notificationService.showSuccess('Your settings have been updated.');
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const userId = this.currentUser()?.id;
    if (!userId) return;

    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) { // 2MB limit
      this.uploadMessage.set('Error: File size must be under 2MB.');
      this.uploadError.set(true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const settingsToSave: Omit<SubAdminSettings, 'id'> = {
        subAdminId: userId,
        ...this.settings(),
        ...this.settingsForm.value,
        logoUrl: reader.result as string,
      };
      this.dataService.updateSubAdminSettings(settingsToSave);
      this.uploadMessage.set('Logo updated successfully!');
      this.uploadError.set(false);
    };
    reader.onerror = () => {
      this.uploadMessage.set('Error: Could not read the file.');
      this.uploadError.set(true);
    };
    reader.readAsDataURL(file);
    
    input.value = '';
  }
}