import { Component, ChangeDetectionStrategy, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-company-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './company-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanySettingsComponent implements OnInit {
  private settingsService = inject(SettingsService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;
  
  settings = this.settingsService.settings;
  logoUrl = computed(() => this.settings().logoUrl);
  partners = computed(() => this.settings().partners || []);
  
  uploadMessage = signal('');
  uploadError = signal(false);
  showLogoFormatHelp = signal(false);

  settingsForm: FormGroup;
  
  // New state for partner modal
  showPartnerModal = signal(false);
  partnerToEdit = signal<{ name: string; logoUrl: string; } | null>(null);
  partnerForm: FormGroup;
  isSavingPartner = signal(false);

  constructor() {
    this.fb = inject(FormBuilder);
    this.settingsForm = this.fb.group({
      companyName: ['', Validators.required],
      companyAddress1: [''],
      companyAddress2: [''],
      companyEmail: ['', Validators.email],
      companyPhone: [''],
      facebookUrl: [''],
      linkedinUrl: [''],
    });

    this.partnerForm = this.fb.group({
      name: ['', Validators.required],
      logoUrl: ['', Validators.required],
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
    this.settingsService.updateSettings(this.settingsForm.value);
    this.notificationService.showSuccess('Settings updated successfully.');
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) { // 2MB limit
      this.uploadMessage.set('Error: File size must be under 2MB.');
      this.uploadError.set(true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.settingsService.saveLogo(reader.result as string);
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
  
  // --- NEW PARTNER MANAGEMENT LOGIC ---

  openAddPartnerModal(): void {
    this.partnerToEdit.set(null);
    this.partnerForm.reset();
    this.showPartnerModal.set(true);
  }

  openEditPartnerModal(partner: { name: string; logoUrl: string; }): void {
    this.partnerToEdit.set(partner);
    this.partnerForm.patchValue(partner);
    this.showPartnerModal.set(true);
  }

  closePartnerModal(): void {
    this.showPartnerModal.set(false);
  }

  onPartnerLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (file.size > 1 * 1024 * 1024) { // 1MB limit
        this.notificationService.showError('File size must be under 1MB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        this.partnerForm.patchValue({ logoUrl: reader.result as string });
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  savePartner(): void {
    if (this.partnerForm.invalid) {
      this.notificationService.showError('Please provide a name and a logo URL/upload.');
      return;
    }
    this.isSavingPartner.set(true);

    const formValue = this.partnerForm.value;
    const editingPartner = this.partnerToEdit();
    let currentPartners = [...this.partners()];

    if (editingPartner) {
      // Editing existing partner
      const index = currentPartners.findIndex(p => p.name === editingPartner.name);
      if (index > -1) {
        currentPartners[index] = formValue;
      }
    } else {
      // Adding new partner, check for duplicates
      if (currentPartners.some(p => p.name.toLowerCase() === formValue.name.toLowerCase())) {
        this.notificationService.showError(`Partner "${formValue.name}" already exists.`);
        this.isSavingPartner.set(false);
        return;
      }
      currentPartners.push(formValue);
    }
    
    this.settingsService.updateSettings({ partners: currentPartners });
    this.notificationService.showSuccess(`Partner "${formValue.name}" saved successfully.`);
    this.closePartnerModal();
    this.isSavingPartner.set(false);
  }


  deletePartner(partnerToDelete: { name: string; logoUrl: string; }): void {
    const updatedPartners = this.partners().filter(p => p.name !== partnerToDelete.name);
    this.settingsService.updateSettings({ partners: updatedPartners });
    this.notificationService.showSuccess(`Partner "${partnerToDelete.name}" removed.`);
  }
}
