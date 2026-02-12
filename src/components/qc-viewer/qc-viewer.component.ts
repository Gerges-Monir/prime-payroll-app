import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { NotificationService } from '../../services/notification.service';
import { QcSubmission } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

declare var JSZip: any;

@Component({
  selector: 'app-qc-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, ConfirmationModalComponent],
  templateUrl: './qc-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QcViewerComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);

  // Data
  submissions = this.dataService.qcSubmissions;
  users = this.dataService.users;
  templates = this.dataService.qcFormTemplates;
  userMap = computed(() => new Map(this.users().map(u => [u.id, u])));

  // Filters
  startDate = signal('');
  endDate = signal('');
  selectedUserId = signal<string>('all');
  selectedTemplateId = signal<string>('all');
  accountNumberFilter = signal('');
  
  // UI State
  expandedSubmissionId = signal<string | null>(null);
  imageToPreview = signal<string | null>(null);
  isDownloadingZip = signal(false);

  // Delete confirmation
  showDeleteConfirm = signal(false);
  submissionToDelete = signal<QcSubmission | null>(null);

  filteredSubmissions = computed(() => {
    let subs = [...this.submissions()];
    const start = this.startDate();
    const end = this.endDate();
    const userId = this.selectedUserId();
    const templateId = this.selectedTemplateId();
    const accountNumber = this.accountNumberFilter().trim();

    if (start) {
      subs = subs.filter(s => s.submissionDate >= start);
    }
    if (end) {
      subs = subs.filter(s => s.submissionDate <= end);
    }
    if (userId !== 'all') {
      subs = subs.filter(s => s.userId === userId);
    }
    if (templateId !== 'all') {
      subs = subs.filter(s => s.formTemplateId === templateId);
    }
    if (accountNumber) {
        subs = subs.filter(s => s.accountNumber && s.accountNumber.includes(accountNumber));
    }

    return subs.sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime());
  });

  toggleDetails(submissionId: string) {
    this.expandedSubmissionId.update(current => current === submissionId ? null : submissionId);
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

  previewImage(imageUrl: string): void {
    this.imageToPreview.set(imageUrl);
  }

  closeImagePreview(): void {
    this.imageToPreview.set(null);
  }

  async downloadAllAsZip(submission: QcSubmission): Promise<void> {
    if (!submission.uploads || submission.uploads.length === 0) {
      this.notificationService.showError('No images to download for this submission.');
      return;
    }
    
    this.isDownloadingZip.set(true);
    this.notificationService.show('Preparing ZIP file, this may take a moment...', 'info', 5000);

    try {
      const zip = new JSZip();
      
      const imagePromises = submission.uploads.map(async (upload) => {
        try {
            // Using fetch on a data URI is a standard way to convert it to a blob
            const response = await fetch(upload.dataUrl);
            if (!response.ok) throw new Error(`Failed to process image data: ${upload.fileName}`);
            const blob = await response.blob();
            const safeFileName = upload.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            return { name: safeFileName, blob };
        } catch (error) {
            console.error('Error processing an image for zipping:', error);
            return null;
        }
      });

      const results = await Promise.all(imagePromises);

      let filesAdded = 0;
      results.forEach(result => {
        if (result) {
            zip.file(result.name, result.blob);
            filesAdded++;
        }
      });
      
      if (filesAdded === 0) {
          throw new Error('Could not process any of the images for download.');
      }

      const content = await zip.generateAsync({ type: 'blob' });
      
      const a = document.createElement('a');
      const url = URL.createObjectURL(content);
      a.href = url;
      const techName = this.userMap().get(submission.userId)?.name.replace(/\s/g, '_') || 'UnknownTech';
      a.download = `QC_Submission_${submission.submissionDate}_${techName}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      
      this.notificationService.showSuccess('ZIP file download started.');

    } catch (error) {
      this.notificationService.showError(error instanceof Error ? error.message : 'Failed to create ZIP file.');
    } finally {
      this.isDownloadingZip.set(false);
    }
  }
}
