import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { QcFormTemplate, QcSubmission, QcImageUpload } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

interface SectionUpload {
  name: string;
  file: File | null;
  previewUrl: string | null; // This will be the base64 dataUrl
  fileName: string;
  fileType: string;
}

@Component({
  selector: 'app-qc-uploader',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, ConfirmationModalComponent],
  templateUrl: './qc-uploader.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QcUploaderComponent {
  private dataService = inject(DatabaseService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);

  currentUser = this.authService.currentUser;
  
  templates = computed(() => this.dataService.qcFormTemplates().filter(t => t.isActive));
  
  selectedDate = signal(new Date().toISOString().split('T')[0]);
  selectedTemplateId = signal<string>('');
  
  selectedTemplate = computed(() => this.templates().find(t => t.id === this.selectedTemplateId()) ?? null);

  isToday = computed(() => {
    const selected = this.selectedDate();
    if (!selected) return false;
    
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    const todayString = `${year}-${month}-${day}`;
    
    return selected === todayString;
  });

  // State for the "New Submission" form
  uploadSections = signal<SectionUpload[]>([]);
  accountNumber = signal('');
  isSaving = signal(false);

  filesReadyCount = computed(() => this.uploadSections().filter(s => s.file !== null).length);
  canSave = computed(() => this.filesReadyCount() > 0 && !this.isSaving());

  // State for existing submissions
  submissionsForSelectedDate = computed(() => {
    const date = this.selectedDate();
    const templateId = this.selectedTemplateId();
    const userId = this.currentUser()?.id;
    if (!date || !templateId || !userId) return [];

    return this.dataService.qcSubmissions()
      .filter(s => s.userId === userId && s.submissionDate === date && s.formTemplateId === templateId)
      .sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime());
  });
  updatingImageState = signal<{ [key: string]: 'processing' | null }>({});

  // Delete confirmation
  showDeleteConfirm = signal(false);
  submissionToDelete = signal<QcSubmission | null>(null);

  constructor() {
    effect(() => {
      const activeTemplates = this.templates();
      if (activeTemplates.length > 0 && !this.selectedTemplateId()) {
        this.selectedTemplateId.set(activeTemplates[0].id);
      }
    });
    
    // When template or date changes, reset the form
    effect(() => {
      this.resetForm();
    });
  }

  resetForm(): void {
    const template = this.selectedTemplate();
    if (!template) {
      this.uploadSections.set([]);
      return;
    }
    this.uploadSections.set(template.sections.map(name => ({
      name, file: null, previewUrl: null, fileName: '', fileType: ''
    })));
    this.accountNumber.set('');
  }

  private async compressImage(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.src = URL.createObjectURL(file);
        image.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1280;
            let width = image.width;
            let height = image.height;

            if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
            else { if (height > MAX_WIDTH) { width *= MAX_WIDTH / height; height = MAX_WIDTH; } }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                URL.revokeObjectURL(image.src);
                return reject(new Error('Could not get canvas context'));
            }
            ctx.drawImage(image, 0, 0, width, height);
            URL.revokeObjectURL(image.src);
            canvas.toBlob(
                (blob) => {
                    if (!blob) return reject(new Error('Canvas to Blob failed'));
                    const name = file.name.replace(/\.[^/.]+$/, ".jpg");
                    const compressedFile = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
                    resolve(compressedFile.size > file.size ? file : compressedFile);
                }, 'image/jpeg', 0.8
            );
        };
        image.onerror = (error) => { URL.revokeObjectURL(image.src); reject(error); };
    });
  }
  
  private readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
  }

  async onFileSelected(event: Event, sectionToUpdate: SectionUpload): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const compressedFile = await this.compressImage(file);
      const dataUrl = await this.readFileAsDataURL(compressedFile);
      
      this.uploadSections.update(sections =>
        sections.map(s => s.name === sectionToUpdate.name ? { 
            ...s, 
            file: compressedFile, 
            previewUrl: dataUrl,
            fileName: compressedFile.name,
            fileType: compressedFile.type,
        } : s)
      );
    } catch (e) {
      this.notificationService.showError('Failed to process image.');
    }
  }

  deleteImage(sectionName: string): void {
    this.uploadSections.update(sections =>
        sections.map(s => s.name === sectionName ? { ...s, previewUrl: null, file: null, fileName: '', fileType: '' } : s)
    );
  }
  
  async saveSubmission(): Promise<void> {
    const sectionsWithFiles = this.uploadSections().filter(s => s.file && s.previewUrl);
    const user = this.currentUser();
    const template = this.selectedTemplate();

    if (sectionsWithFiles.length === 0 || !user || !template) {
        this.notificationService.showError("Please upload at least one image before saving.");
        return;
    }

    this.isSaving.set(true);

    const uploads: QcImageUpload[] = sectionsWithFiles.map(s => ({
      section: s.name,
      fileName: s.fileName,
      fileType: s.fileType,
      dataUrl: s.previewUrl!,
    }));

    const submission: Omit<QcSubmission, 'id'> = {
        userId: user.id,
        techId: user.techId,
        formTemplateId: template.id,
        formTemplateName: template.name,
        submissionDate: this.selectedDate(),
        accountNumber: this.accountNumber().trim() || undefined,
        uploads,
        dateCreated: new Date().toISOString(),
    };

    try {
        await this.dataService.addQcSubmission(submission);
        this.notificationService.showSuccess('New submission saved successfully!');
        this.resetForm();
    } catch (e) {
        this.notificationService.showError(e instanceof Error ? e.message : 'A failure occurred during submission.');
    } finally {
        this.isSaving.set(false);
    }
  }

  // --- METHODS FOR EDITING ---

  getUpload(submission: QcSubmission, sectionName: string): QcImageUpload | undefined {
    return submission.uploads.find(u => u.section === sectionName);
  }

  async onReplaceFile(event: Event, sectionName: string, submission: QcSubmission): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const stateKey = `${submission.id}_${sectionName}`;
    this.updatingImageState.update(s => ({ ...s, [stateKey]: 'processing' }));

    try {
      const compressedFile = await this.compressImage(file);
      const dataUrl = await this.readFileAsDataURL(compressedFile);

      const newUpload: QcImageUpload = {
        section: sectionName,
        fileName: compressedFile.name,
        fileType: compressedFile.type,
        dataUrl: dataUrl,
      };

      const updatedUploads = submission.uploads.filter(u => u.section !== sectionName);
      updatedUploads.push(newUpload);

      await this.dataService.updateQcSubmission(submission.id, { uploads: updatedUploads });
      this.notificationService.showSuccess(`Image for "${sectionName}" updated.`);

    } catch (e) {
      this.notificationService.showError(e instanceof Error ? e.message : 'Failed to replace image.');
    } finally {
      this.updatingImageState.update(s => ({ ...s, [stateKey]: null }));
      (event.target as HTMLInputElement).value = '';
    }
  }

  deleteSubmission(sub: QcSubmission) {
    this.submissionToDelete.set(sub);
    this.showDeleteConfirm.set(true);
  }

  async handleDelete(confirmed: boolean): Promise<void> {
    const sub = this.submissionToDelete();
    this.showDeleteConfirm.set(false);

    if (confirmed && sub) {
      try {
        await this.dataService.deleteQcSubmission(sub.id);
        this.notificationService.showSuccess('Submission deleted successfully.');
      } catch (e) {
        this.notificationService.showError(e instanceof Error ? e.message : 'Failed to delete submission.');
      }
    }
    this.submissionToDelete.set(null);
  }
}
