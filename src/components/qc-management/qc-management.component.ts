import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { NotificationService } from '../../services/notification.service';
import { QcFormTemplate } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

@Component({
  selector: 'app-qc-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DatePipe, ConfirmationModalComponent],
  templateUrl: './qc-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QcManagementComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  templates = computed(() => 
    this.dataService.qcFormTemplates().sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime())
  );

  showModal = signal(false);
  isSaving = signal(false);
  templateToEdit = signal<QcFormTemplate | null>(null);
  
  showDeleteConfirm = signal(false);
  templateToDelete = signal<QcFormTemplate | null>(null);

  templateForm: FormGroup;

  constructor() {
    this.fb = inject(FormBuilder);
    this.templateForm = this.fb.group({
      name: ['', Validators.required],
      isActive: [true],
      sections: this.fb.array([]),
    });
  }

  get sections(): FormArray {
    return this.templateForm.get('sections') as FormArray;
  }

  addSection(): void {
    this.sections.push(this.fb.control('', Validators.required));
  }

  removeSection(index: number): void {
    this.sections.removeAt(index);
  }

  openModal(template?: QcFormTemplate): void {
    this.sections.clear();
    if (template) {
      this.templateToEdit.set(template);
      this.templateForm.patchValue(template);
      if (template.sections) {
        template.sections.forEach(s => this.sections.push(this.fb.control(s, Validators.required)));
      }
    } else {
      this.templateToEdit.set(null);
      this.templateForm.reset({ isActive: true });
      this.addSection(); // Add one section by default for new templates
    }
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  async saveTemplate(): Promise<void> {
    if (this.templateForm.invalid) {
      this.notificationService.showError('Please fill out all required fields.');
      return;
    }

    this.isSaving.set(true);
    const formValue = this.templateForm.value;
    const editingTemplate = this.templateToEdit();

    try {
      if (editingTemplate) {
        const updatedTemplate: QcFormTemplate = { ...editingTemplate, ...formValue };
        await this.dataService.updateQcFormTemplate(updatedTemplate);
        this.notificationService.showSuccess(`Template "${updatedTemplate.name}" updated.`);
      } else {
        const newTemplate: Omit<QcFormTemplate, 'id'> = {
          ...formValue,
          dateCreated: new Date().toISOString(),
        };
        await this.dataService.addQcFormTemplate(newTemplate);
        this.notificationService.showSuccess(`Template "${newTemplate.name}" created.`);
      }
      this.closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      this.notificationService.showError(message);
    } finally {
      this.isSaving.set(false);
    }
  }

  deleteTemplate(template: QcFormTemplate): void {
    this.templateToDelete.set(template);
    this.showDeleteConfirm.set(true);
  }

  async handleDelete(confirmed: boolean): Promise<void> {
    const template = this.templateToDelete();
    this.showDeleteConfirm.set(false);
    if (confirmed && template) {
      try {
        await this.dataService.deleteQcFormTemplate(template.id);
        this.notificationService.showSuccess(`Template "${template.name}" deleted.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete template.';
        this.notificationService.showError(message);
      }
    }
    this.templateToDelete.set(null);
  }
}