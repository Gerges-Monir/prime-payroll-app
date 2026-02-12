import { Component, ChangeDetectionStrategy, signal, inject, computed, output } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { Job } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

declare var XLSX: any;

@Component({
  selector: 'app-glo-fiber-upload',
  standalone: true,
  imports: [CommonModule, ConfirmationModalComponent, CurrencyPipe, FormsModule],
  templateUrl: './glo-fiber-upload.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GloFiberUploadComponent {
  private dataService = inject(DatabaseService);

  processedTechnicians = this.dataService.processedTechnicians;
  
  selectedFile = signal<File | null>(null);
  selectedDate = signal<string>(new Date().toISOString().split('T')[0]);
  uploadStatus = signal<'idle' | 'uploading' | 'success' | 'error'>('idle');
  uploadMessage = signal('');
  showClearJobsConfirm = signal(false);
  skippedJobsLog = signal<{ job: Omit<Job, 'id'>, reason: string, key: string }[]>([]);
  uploadWarnings = signal<string[]>([]);
  showFormatHelp = signal(false);

  totalRevenueInFile = signal<number | null>(null);
  totalRevenueAdded = signal<number | null>(null);

  createUser = output<{ techId: string; name: string }>();
  newTechniciansFound = signal<{ techId: string, name: string }[]>([]);

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

  onCreateUser(tech: { techId: string; name: string }): void {
    this.createUser.emit(tech);
    // After emitting, remove the tech from the list to show it's being handled.
    this.newTechniciansFound.update(techs => techs.filter(t => t.techId !== tech.techId));
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
      this.newTechniciansFound.set([]);
    }
  }

  async uploadFile(fileInput: HTMLInputElement): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;
    
    const fileDate = this.selectedDate();
    if (!fileDate) {
        this.uploadStatus.set('error');
        this.uploadMessage.set('Please select a valid date for this payroll file before uploading.');
        return;
    }

    this.uploadStatus.set('uploading');
    this.uploadMessage.set('Reading and processing file...');
    this.skippedJobsLog.set([]);
    this.uploadWarnings.set([]);
    this.totalRevenueInFile.set(null);
    this.totalRevenueAdded.set(null);
    this.newTechniciansFound.set([]);

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const arrayBuffer = e.target.result;
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        const data: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });

        if (data.length === 0) {
          throw new Error("The selected file has no data rows.");
        }

        const headerRow = Object.keys(data[0]).map(h => String(h || '').trim().toLowerCase());
        
        const colMap: { [key: string]: string } = {};
        const requiredCols: { [key: string]: string[] } = {
            techId: ['technician id'],
            techName: ['technician name'],
            qty: ['qty'],
        };

        // Find standard required columns
        for (const key in requiredCols) {
            const foundHeader = headerRow.find(h => requiredCols[key].includes(h));
            if (foundHeader) {
                colMap[key] = Object.keys(data[0])[headerRow.indexOf(foundHeader)];
            }
        }

        // Find Work Order and Task Code columns (combo or separate)
        const comboHeader = headerRow.find(h => h === 'work order task code');
        if (comboHeader) {
            colMap['combo'] = Object.keys(data[0])[headerRow.indexOf(comboHeader)];
        } else {
            const workOrderHeader = headerRow.find(h => h.includes('work order'));
            const taskCodeHeader = headerRow.find(h => h.includes('task code'));
            if (workOrderHeader && taskCodeHeader) {
                colMap['workOrder'] = Object.keys(data[0])[headerRow.indexOf(workOrderHeader)];
                colMap['taskCode'] = Object.keys(data[0])[headerRow.indexOf(taskCodeHeader)];
            }
        }

        // Find revenue columns
        const revenueHeader = headerRow.find(h => h === 'revenue');
        if (revenueHeader) colMap['revenue'] = Object.keys(data[0])[headerRow.indexOf(revenueHeader)];
        const revenuePerHeader = headerRow.find(h => h.includes('revenue per'));
        if (revenuePerHeader) colMap['revenuePer'] = Object.keys(data[0])[headerRow.indexOf(revenuePerHeader)];

        // Validate that we found all necessary columns
        const missingHeaders = Object.keys(requiredCols).filter(k => !colMap[k]);
        if (!colMap['combo'] && (!colMap['workOrder'] || !colMap['taskCode'])) {
            missingHeaders.push("'Work Order Task Code' (or separate 'Work Order' and 'Task Code')");
        }
        if (!colMap['revenue'] && !colMap['revenuePer']) {
            missingHeaders.push("a revenue column");
        }

        if (missingHeaders.length > 0) {
            throw new Error(`Missing required column(s): ${missingHeaders.join(', ')}.`);
        }

        const parsedJobs: Omit<Job, 'id'>[] = [];
        const techIdsInFile = new Map<string, string>(); // techId -> techName
        const warnings: string[] = [];

        for (const [index, row] of data.entries()) {
          const rowNum = index + 2;
          
          const techIdRaw = row[colMap['techId']];
          const techNameRaw = row[colMap['techName']];
          const quantityRaw = row[colMap['qty']];
          
          let workOrderStr: string | null = null;
          let taskCodeStr: string | null = null;
          
          if (colMap['combo']) {
              const comboRaw = row[colMap['combo']];
              if (comboRaw) {
                  const comboValue = String(comboRaw).trim();
                  const firstSpaceIndex = comboValue.indexOf(' ');
                  if (firstSpaceIndex > 0 && firstSpaceIndex < comboValue.length - 1) {
                      workOrderStr = comboValue.substring(0, firstSpaceIndex);
                      taskCodeStr = comboValue.substring(firstSpaceIndex + 1).trim();
                  } else {
                      warnings.push(`Skipping row ${rowNum}: Could not parse Work Order and Task Code from "${comboValue}". Expected a space separator.`);
                      continue;
                  }
              }
          } else {
              workOrderStr = row[colMap['workOrder']] ? String(row[colMap['workOrder']]).trim() : null;
              taskCodeStr = row[colMap['taskCode']] ? String(row[colMap['taskCode']]).trim() : null;
          }

          if (!techIdRaw || !techNameRaw || !workOrderStr || !taskCodeStr || quantityRaw === null) {
             warnings.push(`Skipping row ${rowNum}: missing one or more required values.`);
             continue;
          }
          
          const techId = String(techIdRaw).trim();
          const techName = String(techNameRaw).trim();
          const quantityNum = parseInt(String(quantityRaw), 10);
          
          let revenueNum: number;
          if (colMap['revenue'] && row[colMap['revenue']] !== null) {
            const revenueRaw = row[colMap['revenue']];
            revenueNum = parseFloat(String(revenueRaw).replace(/[^0-9.-]+/g,""));
          } else if (colMap['revenuePer']) {
            const revenuePerRaw = row[colMap['revenuePer']];
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
                techIdsInFile.set(techId, techName);
             }
             parsedJobs.push({ workOrder: workOrderStr, techId, date: fileDate, taskCode: taskCodeStr, revenue: revenueNum, quantity: quantityNum });
          } else {
             warnings.push(`Skipping row ${rowNum}: Parsed Tech ID was empty.`);
          }
        }
        
        this.uploadWarnings.set(warnings);
        const totalFromFile = parsedJobs.reduce((sum, job) => sum + job.revenue, 0);
        this.totalRevenueInFile.set(totalFromFile);
        
        const skippedJobsLog: { job: Omit<Job, 'id'>, reason: string, key: string }[] = [];

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
          this.newTechniciansFound.set(newTechs);
        }

        this.uploadStatus.set('success');
        let successMessage = `Successfully added ${newJobs.length} new jobs.`;
        if (skippedCount > 0) successMessage += ` ${skippedCount} duplicate jobs were skipped.`;
        if (newTechs.length > 0) {
          successMessage += ` Found ${newTechs.length} new technician(s) who need a user profile.`;
        }
        if (warnings.length > 0) {
          successMessage += ` Encountered ${warnings.length} warnings. See details below.`;
        }
        
        this.uploadMessage.set(successMessage);

      } catch (error) {
        this.uploadStatus.set('error');
        this.uploadMessage.set(error instanceof Error ? error.message : 'An unknown error occurred during processing.');
      } finally {
        this.selectedFile.set(null);
        fileInput.value = ''; // Clear file input to allow re-uploading same file
      }
    };
    reader.readAsArrayBuffer(file);
  }
}