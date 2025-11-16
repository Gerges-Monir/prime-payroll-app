import { Component, ChangeDetectionStrategy, signal, inject, input, computed } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
// Fix: Replaced CloudDataService with DatabaseService as it was not found.
import { DatabaseService } from '../../../services/database.service';
import { Job } from '../../../models/payroll.model';

declare var XLSX: any;

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-upload.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileUploadComponent {
  // Fix: Injected DatabaseService instead of the non-existent CloudDataService.
  private dataService = inject(DatabaseService);

  title = input.required<string>();
  description = input.required<string>();

  processedTechnicians = this.dataService.processedTechnicians;
  rateCategoriesExist = computed(() => this.dataService.rateCategories().length > 0);
  usersHaveRateCategories = computed(() => 
    this.dataService.users().filter(u => u.role === 'employee' || u.role === 'sub-admin').every(u => u.rateCategoryId !== undefined)
  );

  selectedFile = signal<File | null>(null);
  uploadStatus = signal<'idle' | 'uploading' | 'success' | 'error'>('idle');
  uploadMessage = signal('');

  async clearJobs() {
    if (confirm('Are you sure you want to clear all current jobs and adjustments? This action cannot be undone.')) {
        await this.dataService.clearJobs();
        this.uploadStatus.set('idle');
        this.uploadMessage.set('All jobs and adjustments have been cleared.');
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile.set(input.files[0]);
      this.uploadStatus.set('idle');
      this.uploadMessage.set('');
    }
  }

  uploadFile(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.uploadStatus.set('uploading');
    this.uploadMessage.set('Reading and processing file...');

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const arrayBuffer = e.target.result;
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

        let headerRowIndex = -1;
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (row && Array.isArray(row) && row.some(cell => cell && String(cell).trim() !== '')) {
                headerRowIndex = i;
                break;
            }
        }

        if (headerRowIndex === -1) {
            throw new Error("Could not find a valid header row in the file.");
        }

        if (data.length < headerRowIndex + 2) {
          throw new Error("The selected file has no data rows after the header.");
        }

        const headerRow = data[headerRowIndex].map(h => String(h || '').trim().toLowerCase());
        const dataRows = data.slice(headerRowIndex + 1);

        const requiredHeaders = ['work order', 'revenue', 'task code', 'qty'];
        const colIndices: { [key: string]: number } = {};
        const missingHeaders: string[] = [];

        requiredHeaders.forEach(header => {
            const index = headerRow.findIndex(h => h.includes(header));
            if (index === -1) {
                const userFriendlyHeader = header.replace(/\b\w/g, l => l.toUpperCase());
                missingHeaders.push(`'${userFriendlyHeader}'`);
            } else {
                colIndices[header] = index;
            }
        });

        if (missingHeaders.length > 0) {
            throw new Error(`Missing required column(s): ${missingHeaders.join(', ')}. Please check the file header.`);
        }

        const newJobs: Omit<Job, 'id'>[] = [];
        const techIdsInFile = new Set<string>();
        const warnings: string[] = [];

        for (const [index, row] of dataRows.entries()) {
          const rowNum = index + 2 + headerRowIndex;
          if (!row || row.length === 0 || row.every(cell => cell === null || cell === '')) {
            continue;
          }

          const workOrder = row[colIndices['work order']];
          const revenue = row[colIndices['revenue']];
          const taskCode = row[colIndices['task code']];
          const quantity = row[colIndices['qty']];

          if (!workOrder || revenue === null || !taskCode || quantity === null) {
             warnings.push(`Skipping row ${rowNum}: missing required data.`);
             continue;
          }
          
          const workOrderStr = String(workOrder);
          const lastTIndex = workOrderStr.lastIndexOf('T');
          if (lastTIndex === -1 || lastTIndex === workOrderStr.length - 1) {
            warnings.push(`Skipping row ${rowNum}: Could not parse Tech ID from Work Order.`);
            continue;
          }
          const techId = workOrderStr.substring(lastTIndex + 1).trim();

          const dateMatch = workOrderStr.match(/D(\d{6})/);
          if (!dateMatch || !dateMatch[1]) {
            warnings.push(`Skipping row ${rowNum}: Could not parse Date from Work Order.`);
            continue;
          }
          
          const dateStr = dateMatch[1];
          const month = parseInt(dateStr.substring(0, 2), 10);
          const day = parseInt(dateStr.substring(2, 4), 10);
          const year = 2000 + parseInt(dateStr.substring(4, 6), 10);
          
          if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
            warnings.push(`Skipping row ${rowNum}: Invalid date parsed.`);
            continue;
          }
          
          const formattedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          
          const revenueNum = parseFloat(String(revenue).replace(/[^0-9.-]+/g,""));
          const quantityNum = parseInt(String(quantity), 10);

          if (isNaN(revenueNum) || isNaN(quantityNum)) {
            warnings.push(`Skipping row ${rowNum}: Invalid revenue or quantity.`);
            continue;
          }
          
          if (techId) {
             techIdsInFile.add(techId);
             newJobs.push({ techId, date: formattedDate, taskCode: String(taskCode), revenue: revenueNum, quantity: quantityNum });
          } else {
             warnings.push(`Skipping row ${rowNum}: Parsed Tech ID was empty.`);
          }
        }
        
        const existingTechIds = new Set(this.dataService.users().map(u => u.techId));
        const newTechIds = Array.from(techIdsInFile).filter(id => !existingTechIds.has(id));
        
        this.dataService.addJobs(newJobs);
        if (newTechIds.length > 0) {
          this.dataService.addPlaceholderUsers(newTechIds);
        }

        this.uploadStatus.set('success');
        let successMessage = `Successfully added ${newJobs.length} jobs.`;
        if (newTechIds.length > 0) {
            successMessage += ` ${newTechIds.length} new user(s) were created. Please update their profiles in 'Manage Employees'.`;
        }
        if (warnings.length > 0) {
            successMessage += ` Encountered ${warnings.length} warnings (check console for details).`;
            console.warn("File upload warnings:", warnings);
        }
        this.uploadMessage.set(successMessage);

      } catch (error) {
        this.uploadStatus.set('error');
        this.uploadMessage.set(error instanceof Error ? error.message : 'An unknown error occurred during processing.');
      }
    };
    reader.readAsArrayBuffer(file);
  }
}
