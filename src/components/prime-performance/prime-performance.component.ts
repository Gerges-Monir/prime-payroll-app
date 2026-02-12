import { Component, ChangeDetectionStrategy, inject, signal, computed, effect, ElementRef, ViewChild, WritableSignal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { NotificationService } from '../../services/notification.service';
import { PerformanceService } from '../../services/performance.service';
import { PerformanceChartComponent } from '../shared/performance-chart/performance-chart.component';
import { PerformanceDataset, User } from '../../models/payroll.model';

declare var XLSX: any;
declare var html2canvas: any;
declare var JSZip: any;
declare var d3: any;

interface TechFromDataset {
  techId: string;
  name: string;
  data: any;
  user: User | undefined;
}

interface GeneratedReport {
  imageDataUrl: string | null;
  techData: any;
  perfData: any;
  isGenerating: boolean;
  isPublished: boolean;
  notes: WritableSignal<string>;
}

interface TrendAnalysisDataset extends PerformanceDataset {
  selected: boolean;
}

@Component({
  selector: 'app-prime-performance',
  standalone: true,
  imports: [CommonModule, FormsModule, PerformanceChartComponent, DatePipe],
  templateUrl: './prime-performance.component.html',
  styleUrls: ['./prime-performance.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrimePerformanceComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private performanceService = inject(PerformanceService);

  @ViewChild('trendChartContainer') trendChartContainer!: ElementRef;

  datasets = computed(() => 
    this.dataService.performanceDatasets().sort((a,b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())
  );
  selectedDatasetId = signal<string | null>(null);

  isGenerating = signal(false);
  isPublishing = signal(false);

  techniciansInDataset = signal<TechFromDataset[]>([]);
  technicianFilterTerm = signal('');
  selectedTechnicianIds = signal<Set<string>>(new Set());
  
  filteredTechniciansInDataset = computed(() => {
    const term = this.technicianFilterTerm().toLowerCase();
    const techs = this.techniciansInDataset();
    if (!term) return techs;
    return techs.filter(t => t.name.toLowerCase().includes(term) || t.techId.toLowerCase().includes(term));
  });
  
  areAllFilteredTechniciansSelected = computed(() => {
    const filteredTechs = this.filteredTechniciansInDataset();
    if (filteredTechs.length === 0) return false;
    const selectedIds = this.selectedTechnicianIds();
    return filteredTechs.every(tech => selectedIds.has(tech.techId));
  });

  generatedReports = signal<Map<string, GeneratedReport>>(new Map());
  
  hasGeneratedUnpublishedReports = computed(() => {
    for(const report of this.generatedReports().values()) {
        if(report.imageDataUrl && !report.isPublished) {
            return true;
        }
    }
    return false;
  });

  selectedTechnicianForAnalysis = signal<TechFromDataset | null>(null);
  analysisData = signal<any[]>([]);
  isAnalyzing = signal(false);
  availableTrendDatasets = signal<TrendAnalysisDataset[]>([]);
  
  private usersMap = computed(() => new Map(this.dataService.users().map(u => [u.techId, u])));

  constructor() {
    effect(() => {
      const datasets = this.datasets();
      if (datasets.length > 0 && !this.selectedDatasetId()) {
        this.selectedDatasetId.set(datasets[0].id);
      }
    });

    effect(() => {
      const datasetId = this.selectedDatasetId();
      if (datasetId) {
        this.parseSelectedDataset(datasetId);
      } else {
        this.techniciansInDataset.set([]);
      }
      this.generatedReports.set(new Map()); // Clear generated reports when dataset changes
    });

    effect(() => {
      this.runIndividualAnalysis();
    });
  }

  private getWeekStartDateForDataset(dataset: PerformanceDataset): string {
      const uploadDate = this.dataService.parseDateAsUTC(dataset.uploadDate);
      const weekStart = this.dataService.getStartOfWeek(uploadDate);
      if (isNaN(weekStart.getTime())) {
          console.error(`Could not determine week start for invalid date: ${dataset.uploadDate}`);
          return ''; // Return an empty string or handle error appropriately
      }
      return weekStart.toISOString().split('T')[0];
  }

  async parseSelectedDataset(datasetId: string): Promise<void> {
    const dataset = this.datasets().find(d => d.id === datasetId);
    if (!dataset) return;

    try {
        const response = await fetch(dataset.dataUrl);
        const blob = await response.blob();
        const { technicians: data } = await this.performanceService.parseAndCleanFile(new File([blob], dataset.fileName));
        
        const uMap = this.usersMap();
        const techs = data.map((techData: any) => ({
            techId: String(techData['Tech #']).trim(),
            name: techData['Name'],
            data: techData,
            user: uMap.get(String(techData['Tech #']).trim()),
        })).sort((a,b) => a.name.localeCompare(b.name));

        this.techniciansInDataset.set(techs);
        this.selectedTechnicianIds.set(new Set());
        this.selectedTechnicianForAnalysis.set(null);

    } catch(err) {
        this.notificationService.showError(`Failed to parse dataset: ${err instanceof Error ? err.message : 'Unknown error'}`);
        this.techniciansInDataset.set([]);
    }
  }

  toggleTechnicianSelection(techId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedTechnicianIds.update(currentSet => {
        if (input.checked) {
            currentSet.add(techId);
        } else {
            currentSet.delete(techId);
        }
        return new Set(currentSet);
    });

    const selectedIds = this.selectedTechnicianIds();
    if (selectedIds.size === 1) {
        const singleId = selectedIds.values().next().value;
        const tech = this.techniciansInDataset().find(t => t.techId === singleId);
        if (tech) {
          this.selectedTechnicianForAnalysis.set(tech);
          this.prepareTrendDatasets(tech.techId);
        }
    } else {
        this.selectedTechnicianForAnalysis.set(null);
    }
  }

  toggleSelectAll(event: Event): void {
    const input = event.target as HTMLInputElement;
    const filteredIds = new Set(this.filteredTechniciansInDataset().map(t => t.techId));

    if (input.checked) {
      // Add all filtered technicians to the selection
      this.selectedTechnicianIds.update(currentSet => {
          filteredIds.forEach(id => currentSet.add(id));
          return new Set(currentSet);
      });
    } else {
        // Remove all filtered technicians from the selection
        this.selectedTechnicianIds.update(currentSet => {
            filteredIds.forEach(id => currentSet.delete(id));
            return new Set(currentSet);
        });
    }
    this.selectedTechnicianForAnalysis.set(null);
  }

  async generateDashboards(): Promise<void> {
    this.isGenerating.set(true);
    const reports = new Map<string, GeneratedReport>();
    const selectedIds = this.selectedTechnicianIds();
    const allTechs = this.techniciansInDataset();
    const dataset = this.datasets().find(d => d.id === this.selectedDatasetId());
    if(!dataset) {
      this.notificationService.showError("Could not find selected dataset.");
      this.isGenerating.set(false);
      return;
    }
    const weekStartDate = this.getWeekStartDateForDataset(dataset);
    const monthName = new Date(dataset.uploadDate).toLocaleString('en-US', { month: 'long' }).toUpperCase();
    
    for (const techId of selectedIds) {
        const tech = allTechs.find(t => t.techId === techId);
        if (tech && tech.user) {
            const perfData = this.performanceService.calculatePerformance(tech.data, monthName);
            const reportId = `${weekStartDate}_${tech.user.id}`;
            const existingReport = this.dataService.performanceReports().find(r => r.id === reportId);
            
            reports.set(techId, { 
              techData: tech.data, 
              perfData, 
              imageDataUrl: existingReport?.imageDataUrl || null,
              isGenerating: true,
              isPublished: existingReport?.status === 'published',
              notes: signal(existingReport?.notes || '')
            });
        }
    }
    this.generatedReports.set(reports);
    
    await new Promise(resolve => setTimeout(resolve, 50));

    const generationPromises = Array.from(reports.entries()).map(async ([techId, report]) => {
      const element = document.getElementById(`chart-gen-${techId}`);
      if (element) {
        try {
          const canvas = await html2canvas(element, { scale: 1.5 });
          report.imageDataUrl = canvas.toDataURL('image/png');
        } catch(e) {
            console.error(`Failed to capture chart for ${techId}`, e);
        } finally {
          report.isGenerating = false;
          this.generatedReports.update(r => new Map(r.set(techId, report)));
        }
      }
    });

    await Promise.all(generationPromises);
    
    this.isGenerating.set(false);
    this.notificationService.showSuccess(`Generated ${reports.size} dashboards.`);
  }
  
  async publishReport(techId: string): Promise<void> {
    const report = this.generatedReports().get(techId);
    const tech = this.techniciansInDataset().find(t => t.techId === techId);
    const dataset = this.datasets().find(d => d.id === this.selectedDatasetId());
    
    if(!report || !tech || !tech.user || !dataset || !report.imageDataUrl) {
      this.notificationService.showError("Missing data to publish report.");
      return;
    }

    const reportData = {
      userId: tech.user.id,
      weekStartDate: this.getWeekStartDateForDataset(dataset),
      imageDataUrl: report.imageDataUrl,
      notes: report.notes()
    };
    
    try {
      await this.dataService.addOrUpdatePerformanceReport(reportData);
      const reportId = `${reportData.weekStartDate}_${reportData.userId}`;
      await this.dataService.updatePerformanceReport(reportId, { status: 'published' });
      this.generatedReports.update(map => {
        const r = map.get(techId);
        if(r) r.isPublished = true;
        return new Map(map);
      });
      this.notificationService.showSuccess(`Report for ${tech.name} has been published.`);
    } catch (e) {
      this.notificationService.showError("Failed to publish report.");
    }
  }

  async unpublishReport(techId: string): Promise<void> {
    const report = this.generatedReports().get(techId);
    const tech = this.techniciansInDataset().find(t => t.techId === techId);
    const dataset = this.datasets().find(d => d.id === this.selectedDatasetId());

    if(!report || !tech || !tech.user || !dataset) {
      this.notificationService.showError("Missing data to unpublish report.");
      return;
    }
    
    const reportId = `${this.getWeekStartDateForDataset(dataset)}_${tech.user.id}`;
    
    try {
      await this.dataService.deletePerformanceReport(reportId);
      this.generatedReports.update(map => {
        const r = map.get(techId);
        if(r) r.isPublished = false;
        return new Map(map);
      });
      this.notificationService.showSuccess(`Report for ${tech.name} has been unpublished.`);
    } catch(e) {
      this.notificationService.showError("Failed to unpublish report.");
    }
  }
  
  async publishAllReports(): Promise<void> {
    this.isPublishing.set(true);
    let successCount = 0;
    const reportsToPublish = Array.from(this.generatedReports().entries()).filter(([_, r]) => r.imageDataUrl && !r.isPublished);
    const dataset = this.datasets().find(d => d.id === this.selectedDatasetId());
    
    if (!dataset) {
        this.notificationService.showError("Could not find selected dataset.");
        this.isPublishing.set(false);
        return;
    }

    for(const [techId, report] of reportsToPublish) {
       const tech = this.techniciansInDataset().find(t => t.techId === techId);
       if(!tech || !tech.user) continue;
       
       const reportData = {
          userId: tech.user.id,
          weekStartDate: this.getWeekStartDateForDataset(dataset),
          imageDataUrl: report.imageDataUrl!,
          notes: report.notes(),
       };
       try {
        await this.dataService.addOrUpdatePerformanceReport(reportData);
        const reportId = `${reportData.weekStartDate}_${reportData.userId}`;
        await this.dataService.updatePerformanceReport(reportId, { status: 'published' });

        this.generatedReports.update(map => {
          const r = map.get(techId);
          if(r) r.isPublished = true;
          return new Map(map);
        });
        successCount++;
       } catch (e) {
         // silently fail for one, but log it
         console.error(`Failed to publish report for ${tech.name}`, e);
       }
    }
    
    this.notificationService.showSuccess(`Successfully published ${successCount} reports.`);
    this.isPublishing.set(false);
  }

  async downloadSingleDashboard(report: GeneratedReport): Promise<void> {
    if (!report.imageDataUrl) {
      this.notificationService.showError('Image data is not available for this report.');
      return;
    }
    const a = document.createElement('a');
    a.href = report.imageDataUrl;
    a.download = `Performance_Report_${report.techData['Tech #']}_${report.techData['Name'].replace(/\s/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async downloadZip(): Promise<void> {
    const reports = this.generatedReports();
    if (reports.size === 0) {
        this.notificationService.showError("No dashboards generated to download.");
        return;
    }
    const zip = new JSZip();
    const summaryData = [];

    for (const [techId, report] of reports.entries()) {
      if(report.imageDataUrl) {
        const base64Data = report.imageDataUrl.split(',')[1];
        zip.file(`Tech_${techId}_${report.techData['Name']}.png`, base64Data, { base64: true });
      }
        
      summaryData.push({
          'Tech #': techId,
          'Name': report.techData['Name'],
          'Tier': report.techData['Tier'],
          'Rank': report.techData['RANK'],
          'Total Rating': report.techData['TOTAL RATING'],
          'Points Earned': report.perfData.total_points,
          'Points Utilization %': (report.perfData.utilization * 100).toFixed(1)
      });
    }

    const summaryCSV = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(summaryData));
    zip.file('summary.csv', summaryCSV);

    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `Performance_Reports_${new Date().toISOString().split('T')[0]}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async prepareTrendDatasets(techId: string) {
    const allDatasets = this.datasets();
    const techDatasets: TrendAnalysisDataset[] = [];
    
    for (const dataset of allDatasets) {
        try {
            const response = await fetch(dataset.dataUrl);
            const blob = await response.blob();
            const { technicians: data } = await this.performanceService.parseAndCleanFile(new File([blob], dataset.fileName));
            if (data.some((row: any) => String(row['Tech #']).trim() === techId)) {
                techDatasets.push({ ...dataset, selected: true });
            }
        } catch (e) {
          // ignore datasets that fail to parse
        }
    }
    this.availableTrendDatasets.set(techDatasets);
  }

  toggleTrendDataset(datasetId: string) {
    this.availableTrendDatasets.update(datasets => 
        datasets.map(d => d.id === datasetId ? { ...d, selected: !d.selected } : d)
    );
  }

  async runIndividualAnalysis(): Promise<void> {
    const tech = this.selectedTechnicianForAnalysis();
    if (!tech) {
      this.analysisData.set([]);
      this.drawTrendChart([]);
      return;
    }

    this.isAnalyzing.set(true);
    
    const selectedDatasets = this.availableTrendDatasets().filter(d => d.selected);
    const analysisPoints: any[] = [];

    for (const dataset of selectedDatasets) {
        try {
            const response = await fetch(dataset.dataUrl);
            const blob = await response.blob();
            const { technicians: data } = await this.performanceService.parseAndCleanFile(new File([blob], dataset.fileName));
            
            const techData = data.find((row: any) => String(row['Tech #']).trim() === tech.techId);
            
            if (techData) {
                const monthName = new Date(dataset.uploadDate).toLocaleString('en-US', { month: 'long' }).toUpperCase();
                const perfData = this.performanceService.calculatePerformance(techData, monthName);
                analysisPoints.push({
                    date: new Date(dataset.uploadDate),
                    totalRating: techData['TOTAL RATING'] || 0,
                    pointsEarned: perfData.total_points || 0,
                    positiveCompletion: (techData['Positive Completion %'] || 0) * 100,
                    nps: (techData['NPS %'] || 0) * 100
                });
            }
        } catch(e) {
            console.error(`Could not parse dataset ${dataset.fileName} for analysis`, e);
        }
    }
    
    const sortedData = analysisPoints.sort((a,b) => a.date.getTime() - b.date.getTime());
    this.analysisData.set(sortedData);
    this.drawTrendChart(sortedData);
    this.isAnalyzing.set(false);
  }

  private drawTrendChart(data: any[]): void {
    if (!this.trendChartContainer) return;
    const container = this.trendChartContainer.nativeElement;
    this.clearTrendChart();

    if (data.length === 0) return;

    const margin = { top: 20, right: 80, bottom: 60, left: 50 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 300 - margin.top - margin.bottom;

    const svg = d3.select(container).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime()
        .domain(d3.extent(data, (d: any) => d.date))
        .range([0, width]);
        
    const y = d3.scaleLinear()
        .domain([0, d3.max(data, (d: any) => Math.max(d.totalRating, d.pointsEarned, d.positiveCompletion, d.nps)) || 100])
        .range([height, 0]);

    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(Math.min(data.length, 5)));

    svg.append("g")
        .call(d3.axisLeft(y));
    
    const colors = { totalRating: '#4f46e5', pointsEarned: '#059669', positiveCompletion: '#ea580c', nps: '#0ea5e9' };
    const metrics: (keyof typeof colors)[] = ['totalRating', 'pointsEarned', 'positiveCompletion', 'nps'];

    metrics.forEach(metric => {
      if (data.length > 1) {
        svg.append("path")
            .datum(data)
            .attr("fill", "none")
            .attr("stroke", colors[metric])
            .attr("stroke-width", 2)
            .attr("d", d3.line()
                .x((d: any) => x(d.date))
                .y((d: any) => y(d[metric]))
            );
      } else { // Draw dots if only one data point
        svg.selectAll(`.dot-${metric}`)
           .data(data)
           .enter()
           .append('circle')
           .attr('class', `dot-${metric}`)
           .attr('cx', (d: any) => x(d.date))
           .attr('cy', (d: any) => y(d[metric]))
           .attr('r', 4)
           .style('fill', colors[metric]);
      }
    });
  }

  private clearTrendChart(): void {
    if (this.trendChartContainer) {
        d3.select(this.trendChartContainer.nativeElement).selectAll("*").remove();
    }
  }
}