import { Component, ChangeDetectionStrategy, signal, inject, computed, effect, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { NotificationService } from '../../services/notification.service';
import { DatabaseService } from '../../services/database.service';
import { PerformanceService } from '../../services/performance.service';
import { PerformanceDataset } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

declare var XLSX: any;
declare var html2canvas: any;

interface HeatmapData {
    metrics: { key: string; shortName: string }[];
    techs: {
        techId: string;
        name: string;
        perfData: any;
    }[];
}

interface VerificationData {
  workbook: any;
  fileName: string;
  uploadDate: string;
  companyData: any;
  foundColumns: { [key: string]: string };
}

@Component({
  selector: 'app-team-analysis',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, DatePipe, ConfirmationModalComponent],
  templateUrl: './team-analysis.component.html',
  styleUrls: ['./team-analysis.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamAnalysisComponent {
  private notificationService = inject(NotificationService);
  private dataService = inject(DatabaseService);
  private performanceService = inject(PerformanceService);
  private fb: FormBuilder;
  
  @ViewChild('heatmapContainer') heatmapContainer!: ElementRef;

  isProcessing = signal(false);
  isUploading = signal(false);
  
  newDatasetDate = signal<string>(new Date().toISOString().split('T')[0]);

  datasets = computed(() => 
    this.dataService.performanceDatasets().sort((a,b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())
  );
  selectedDatasetId = signal<string | null>(null);

  heatmapData = signal<HeatmapData | null>(null);
  showFormatHelp = signal(false);

  // Signals for delete confirmation
  showDeleteDatasetConfirm = signal(false);
  datasetToDelete = signal<PerformanceDataset | null>(null);
  
  // Signals for verification modal
  showVerificationModal = signal(false);
  verificationData = signal<VerificationData | null>(null);
  verificationForm: FormGroup;
  verificationFormMetrics = signal<string[]>([]);

  constructor() {
    this.fb = inject(FormBuilder);
    this.verificationForm = this.fb.group({});

    effect(() => {
        const datasets = this.datasets();
        if (datasets.length > 0 && !this.selectedDatasetId()) {
            this.selectedDatasetId.set(datasets[0].id);
        }
    });

    effect(() => {
        const datasetId = this.selectedDatasetId();
        if (datasetId) {
            this.generateHeatmap(datasetId);
        } else {
            this.heatmapData.set(null);
        }
    });
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.isUploading.set(true);
    this.notificationService.show('Parsing and verifying file...', 'info');

    try {
      // Step 1: Parse the file to get company data for verification
      const { companyData, foundColumns } = await this.performanceService.parseAndCleanFile(file);

      if (!companyData) {
        throw new Error("Could not find a company summary row/sheet in the uploaded file.");
      }
      
      // Step 2: Prepare data for the verification modal
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const workbook = XLSX.read(e.target.result, { type: 'array' });
        this.verificationData.set({
          workbook,
          fileName: file.name,
          uploadDate: this.newDatasetDate(),
          companyData,
          foundColumns
        });

        // Step 3: Build the form and show the modal
        this.verificationForm = this.fb.group({});
        const metricKeys = this.performanceService.getScoringKeys();
        
        this.verificationFormMetrics.set(metricKeys.sort((a, b) => a.localeCompare(b)));

        for (const key of metricKeys) {
            const value = companyData[key];
            const isPercent = key.includes('%');
            let displayValue: string | number = ''; // Default to empty string for missing values

            if (typeof value === 'number') { // This will correctly handle 0 but not null
                displayValue = isPercent ? (value * 100).toFixed(2) : value;
            }
            
            // Create a control for every possible metric. If value was null, control will be empty but required.
            this.verificationForm.addControl(key, this.fb.control(displayValue, Validators.required));
        }
        
        this.showVerificationModal.set(true);
        this.isUploading.set(false);
      };
      reader.readAsArrayBuffer(file);

    } catch (err) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Failed to parse file for verification.');
      this.isUploading.set(false);
    } finally {
      input.value = ''; // Reset file input
    }
  }

  async confirmVerification(): Promise<void> {
    if (this.verificationForm.invalid) {
        this.notificationService.showError("All metrics must have a valid value.");
        return;
    }
    
    const data = this.verificationData();
    if (!data) return;

    this.isUploading.set(true);
    this.showVerificationModal.set(false);

    try {
        const { workbook, foundColumns, fileName, uploadDate } = data;
        const editedValues = this.verificationForm.value;

        const companySheetName = workbook.SheetNames.length > 1 ? workbook.SheetNames[1] : 'CompanyData';
        const companyWorksheet = workbook.Sheets[companySheetName];

        let companyRowObject: { [key: string]: any };

        if (companyWorksheet) {
            const jsonData: any[] = XLSX.utils.sheet_to_json(companyWorksheet);
            companyRowObject = jsonData.length > 0 ? jsonData[0] : {};
        } else {
            companyRowObject = {};
        }

        // REBUILT LOGIC: Unconditionally overwrite/add values from the form.
        for (const stdName in editedValues) {
            if (Object.prototype.hasOwnProperty.call(editedValues, stdName)) {
                const formValue = editedValues[stdName];
                const rawValue = parseFloat(formValue);
                const finalValue = !isNaN(rawValue) ? (stdName.includes('%') ? rawValue / 100 : rawValue) : null;
                
                // Find original header or use standard name to create a new column
                const headerToWrite = foundColumns[stdName] || stdName;
                
                // Overwrite the value in the object that represents the Excel row.
                companyRowObject[headerToWrite] = finalValue;
            }
        }
      
        const newSheet = XLSX.utils.json_to_sheet([companyRowObject]);
      
        if (companyWorksheet) {
            workbook.Sheets[companySheetName] = newSheet;
        } else {
            XLSX.utils.book_append_sheet(workbook, newSheet, companySheetName);
        }
      
      // Generate a new base64 data URL from the MODIFIED workbook.
      const newXlsxBase64 = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' });
      const newDataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${newXlsxBase64}`;

      // Save the new dataset with the corrected data.
      await this.dataService.addPerformanceDataset(fileName, newDataUrl, uploadDate);
      this.notificationService.showSuccess(`Dataset '${fileName}' verified and saved successfully.`);

    } catch (err) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Failed to save updated dataset.');
    } finally {
      this.isUploading.set(false);
      this.verificationData.set(null);
    }
  }


  cancelVerification(): void {
    this.showVerificationModal.set(false);
    this.verificationData.set(null);
  }
  
  deleteDataset(dataset: PerformanceDataset): void {
    this.datasetToDelete.set(dataset);
    this.showDeleteDatasetConfirm.set(true);
  }

  async handleDatasetDelete(confirmed: boolean): Promise<void> {
    const dataset = this.datasetToDelete();
    this.showDeleteDatasetConfirm.set(false);

    if (confirmed && dataset) {
      try {
        await this.dataService.deletePerformanceDataset(dataset.id);
        this.notificationService.showSuccess('Dataset deleted.');
        if (this.selectedDatasetId() === dataset.id) {
          this.selectedDatasetId.set(null);
        }
      } catch (e) {
        this.notificationService.showError(e instanceof Error ? e.message : 'Failed to delete dataset.');
      }
    }
    this.datasetToDelete.set(null);
  }

  async generateHeatmap(datasetId: string): Promise<void> {
    const dataset = this.datasets().find(d => d.id === datasetId);
    if (!dataset) {
        this.heatmapData.set(null);
        return;
    }

    this.heatmapData.set(null);
    this.isProcessing.set(true);
    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      const response = await fetch(dataset.dataUrl);
      const blob = await response.blob();
      const { technicians: techsFromFile } = await this.performanceService.parseAndCleanFile(new File([blob], dataset.fileName));
      
      const monthName = new Date(dataset.uploadDate).toLocaleString('en-US', { month: 'long' }).toUpperCase();
      
      const techsWithPerf = techsFromFile.map((tech: any) => ({
        techId: String(tech['Tech #']).trim(),
        name: tech['Name'],
        perfData: this.performanceService.calculatePerformance(tech, monthName)
      })).sort((a,b) => a.name.localeCompare(b.name));

      const firstPerfData = techsWithPerf[0]?.perfData;
      if (!firstPerfData) {
        this.heatmapData.set({ metrics: [], techs: [] });
        return;
      }
      
      const metrics = firstPerfData.detailed.map((d: any) => ({
          key: d.key,
          shortName: d.key.replace(' %', '').replace('Positive ', 'Pos ').replace('SMS Text Compliance', 'SMS')
      }));

      this.heatmapData.set({
        metrics,
        techs: techsWithPerf
      });

    } catch (e) {
      const message = e instanceof Error ? e.message : 'An unknown error occurred during processing.';
      this.notificationService.showError(message);
    } finally {
      this.isProcessing.set(false);
    }
  }

  getMetricData(detailedData: any[], metricKey: string): any | null {
    if (!detailedData) return null;
    return detailedData.find(d => d.key === metricKey) ?? null;
  }

  getMetricColor(points: number | undefined, max: number | undefined): string {
    if (points === undefined || max === undefined || max === 0) return 'bg-slate-50';
    const ratio = points / max;
    if (ratio >= 1) return 'bg-green-200 text-green-900';
    if (ratio > 0.6) return 'bg-lime-200 text-lime-900';
    if (ratio > 0.3) return 'bg-yellow-200 text-yellow-900';
    if (ratio > 0) return 'bg-amber-200 text-amber-900';
    return 'bg-red-200 text-red-900';
  }

  async downloadHeatmap(): Promise<void> {
    const element = this.heatmapContainer.nativeElement;
    if (!element) {
      this.notificationService.showError('Could not find the heatmap element to download.');
      return;
    }
    
    this.notificationService.show('Generating heatmap image...', 'info');

    try {
      const canvas = await html2canvas(element, { scale: 2, useCORS: true });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      
      const dataset = this.datasets().find(d => d.id === this.selectedDatasetId());
      const fileName = dataset ? `Heatmap_${dataset.fileName.replace(/\.(xlsx|xls)/, '')}.png` : 'Heatmap.png';
      a.download = fileName;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

    } catch (e) {
      console.error("Heatmap download error:", e);
      this.notificationService.showError('Failed to generate heatmap image.');
    }
  }
}