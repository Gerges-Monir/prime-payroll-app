import { Component, ChangeDetectionStrategy, signal, inject, input, computed } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { DatabaseService } from '../../../services/database.service';
import { Job } from '../../../models/payroll.model';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';

declare var XLSX: any;

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule, ConfirmationModalComponent, CurrencyPipe],
  templateUrl: './file-upload.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileUploadComponent {
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
  showClearJobsConfirm = signal(false);
  skippedJobsLog = signal<{ job: Omit<Job, 'id'>, reason: string, key: string }[]>([]);
  uploadWarnings = signal<string[]>([]);
  showFormatHelp = signal(false);

  // Signals for revenue summary
  totalRevenueInFile = signal<number | null>(null);
  totalRevenueAdded = signal<number | null>(null);

  clearJobs(): void {
    this.showClearJobsConfirm.set(true);
  }

  async handleClearJobs(confirmed: boolean): Promise<void> {
    this.showClearJobsConfirm.set(false);
    if (confirmed) {
        await this.dataService.clearJobs();
        this.uploadStatus.set('idle');
        this.uploadMessage.set('All jobs and adjustments have been cleared.');
        this.skippedJobsLog.set([]);
        this.uploadWarnings.set([]);
        this.totalRevenueInFile.set(null);
        this.totalRevenueAdded.set(null);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile.set(input.files[0]);
      this.uploadStatus.set('idle');
      this.uploadMessage.set('');
      this.skippedJobsLog.set([]);
      this.uploadWarnings.set([]);
      this.totalRevenueInFile.set(null);
      this.totalRevenueAdded.set(null);
    }
  }

  async uploadFile(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;

    this.uploadStatus.set('uploading');
    this.uploadMessage.set('Reading and processing file...');
    this.skippedJobsLog.set([]);
    this.uploadWarnings.set([]);
    this.totalRevenueInFile.set(null);
    this.totalRevenueAdded.set(null);

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

        const colIndices = {
          workOrder: headerRow.findIndex(h => h.includes('work order')),
          taskCode: headerRow.findIndex(h => h.includes('task code')),
          qty: headerRow.findIndex(h => h === 'qty'),
          revenue: headerRow.findIndex(h => h === 'revenue'),
          revenuePer: headerRow.findIndex(h => h.includes('revenue per')),
          techName: headerRow.findIndex(h => h.includes('technician name')),
        };

        const missingHeaders: string[] = [];
        if (colIndices.workOrder === -1) missingHeaders.push("'Work Order'");
        if (colIndices.taskCode === -1) missingHeaders.push("'Task Code'");
        if (colIndices.qty === -1) missingHeaders.push("'Qty'");
        if (colIndices.revenue === -1 && colIndices.revenuePer === -1) {
            missingHeaders.push("a revenue column ('Revenue' for total, or 'Revenue Per' for unit)");
        }
        
        if (missingHeaders.length > 0) {
            throw new Error(`Missing required column(s): ${missingHeaders.join(', ')}. Please check the file header.`);
        }

        const parsedJobs: Omit<Job, 'id'>[] = [];
        const techIdsInFile = new Map<string, string>();
        const warnings: string[] = [];

        for (const [index, row] of dataRows.entries()) {
          const rowNum = index + 2 + headerRowIndex;
          if (!row || row.length === 0 || row.every(cell => cell === null || cell === '')) {
            continue;
          }

          const workOrderRaw = row[colIndices.workOrder];
          const taskCodeRaw = row[colIndices.taskCode];
          const quantityRaw = row[colIndices.qty];

          if (!workOrderRaw || !taskCodeRaw || quantityRaw === null) {
             warnings.push(`Skipping row ${rowNum}: missing required data (Work Order, Task Code, or Qty).`);
             continue;
          }
          
          const workOrderStr = String(workOrderRaw).trim();
          const taskCodeStr = String(taskCodeRaw).trim();

          const lastTIndex = workOrderStr.lastIndexOf('T');
          if (lastTIndex === -1 || lastTIndex === workOrderStr.length - 1) {
            warnings.push(`Skipping row ${rowNum}: Could not parse Tech ID from Work Order '${workOrderStr}'.`);
            continue;
          }
          const techId = workOrderStr.substring(lastTIndex + 1).trim();

          const dateMatch = workOrderStr.match(/D(\d{6})/);
          if (!dateMatch || !dateMatch[1]) {
            warnings.push(`Skipping row ${rowNum}: Could not parse Date from Work Order '${workOrderStr}'.`);
            continue;
          }
          
          const dateStr = dateMatch[1];
          const month = parseInt(dateStr.substring(0, 2), 10);
          const day = parseInt(dateStr.substring(2, 4), 10);
          const year = 2000 + parseInt(dateStr.substring(4, 6), 10);
          
          if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
            warnings.push(`Skipping row ${rowNum}: Invalid date parsed from '${dateStr}'.`);
            continue;
          }
          
          const formattedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          
          const quantityNum = parseInt(String(quantityRaw), 10);

          let revenueNum: number;
          if (colIndices.revenue !== -1 && row[colIndices.revenue] !== null) {
            const revenueRaw = row[colIndices.revenue];
            revenueNum = parseFloat(String(revenueRaw).replace(/[^0-9.-]+/g,""));
          } else if (colIndices.revenuePer !== -1) {
            const revenuePerRaw = row[colIndices.revenuePer];
            const revenuePerNum = parseFloat(String(revenuePerRaw).replace(/[^0-9.-]+/g,""));
            if (isNaN(revenuePerNum) || isNaN(quantityNum)) {
                warnings.push(`Skipping row ${rowNum}: Invalid 'Revenue Per' or 'Qty' for calculation.`);
                continue;
            }
            revenueNum = revenuePerNum * quantityNum;
          } else {
            warnings.push(`Skipping row ${rowNum}: No valid revenue data found.`);
            continue;
          }

          if (isNaN(revenueNum) || isNaN(quantityNum)) {
            warnings.push(`Skipping row ${rowNum}: Invalid revenue or quantity.`);
            continue;
          }
          
          if (techId) {
             if (!techIdsInFile.has(techId)) {
                let techName = `Tech ${techId}`;
                if (colIndices.techName !== -1 && row[colIndices.techName]) {
                    const nameFromCell = String(row[colIndices.techName]).trim();
                    if (nameFromCell) {
                       techName = nameFromCell;
                    }
                }
                techIdsInFile.set(techId, techName);
             }
             parsedJobs.push({ workOrder: workOrderStr, techId, date: formattedDate, taskCode: taskCodeStr, revenue: revenueNum, quantity: quantityNum });
          } else {
             warnings.push(`Skipping row ${rowNum}: Parsed Tech ID was empty.`);
          }
        }
        
        this.uploadWarnings.set(warnings);
        const totalFromFile = parsedJobs.reduce((sum, job) => sum + job.revenue, 0);
        this.totalRevenueInFile.set(totalFromFile);
        
        const skippedJobsLog: { job: Omit<Job, 'id'>, reason: string, key: string }[] = [];

        // Refined Duplicate Check: A job is a duplicate if Work Order, Task Code, AND Tech ID match.
        const existingJobKeys = new Set(this.dataService.jobs().map(j => `${j.workOrder.trim().toLowerCase()}|${j.taskCode.trim().toLowerCase()}|${j.techId.trim().toLowerCase()}`));
        const seenInFile = new Set<string>();
        const newJobs = parsedJobs.filter(job => {
            const key = `${job.workOrder.trim().toLowerCase()}|${job.taskCode.trim().toLowerCase()}|${job.techId.trim().toLowerCase()}`;
            if (existingJobKeys.has(key)) {
                skippedJobsLog.push({ job, reason: 'Duplicate of an existing job in the database.', key });
                return false;
            }
            if (seenInFile.has(key)) {
                skippedJobsLog.push({ job, reason: 'Duplicate of another job within the same file.', key });
                return false;
            }
            seenInFile.add(key);
            return true;
        });
        const skippedCount = parsedJobs.length - newJobs.length;

        const totalAdded = newJobs.reduce((sum, job) => sum + job.revenue, 0);
        this.totalRevenueAdded.set(totalAdded);

        if (skippedJobsLog.length > 0) {
            this.skippedJobsLog.set(skippedJobsLog);
        }

        // Identify new users only from the jobs that are actually new
        const techIdsInNewJobs = new Set(newJobs.map(j => j.techId));
        const existingTechIds = new Set(this.dataService.users().map(u => u.techId));
        const newTechs: { techId: string, name: string }[] = [];
        for (const techId of techIdsInNewJobs) {
            if (!existingTechIds.has(techId)) {
                const techName = techIdsInFile.get(techId);
                if (techName) {
                    newTechs.push({ techId, name: techName });
                }
            }
        }
        
        if (newJobs.length > 0) {
          await this.dataService.addJobs(newJobs);
        }
        
        if (newTechs.length > 0) {
          await this.dataService.addPlaceholderUsers(newTechs);
        }

        this.uploadStatus.set('success');
        let successMessage = `Successfully added ${newJobs.length} new jobs.`;
        if (skippedCount > 0) {
            successMessage += ` ${skippedCount} duplicate jobs were skipped.`;
        }
        if (newTechs.length > 0) {
            successMessage += ` ${newTechs.length} new user(s) were created.`;
            const rateCategories = this.dataService.rateCategories();
            const standardCategory = rateCategories.find(c => c.name.toLowerCase() === 'standard');
            if (standardCategory) {
                successMessage += ` They were automatically assigned the 'Standard' rate category.`;
            } else {
                successMessage += ` Please assign a rate category in 'Manage Employees'.`;
            }
        }
        if (warnings.length > 0) {
            successMessage += ` Encountered ${warnings.length} warnings. See details below.`;
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
