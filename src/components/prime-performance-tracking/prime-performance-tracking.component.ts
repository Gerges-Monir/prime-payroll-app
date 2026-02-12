import { Component, ChangeDetectionStrategy, inject, signal, computed, effect, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { PerformanceService } from '../../services/performance.service';
import { PerformanceDataset } from '../../models/payroll.model';
import { NotificationService } from '../../services/notification.service';

declare var d3: any;
declare var html2canvas: any;
declare var XLSX: any;

interface ProcessedResult {
  techData: any;
  perfData: any;
}

interface ProcessedDataset {
  dataset: PerformanceDataset;
  results: ProcessedResult[];
  companyData: any | null; // NEW
}

interface ChartDataPoint {
  date: Date;
  tier?: string;
  [key: string]: any;
}

interface PerformanceMetric {
  key: string;
  label: string;
}

@Component({
  selector: 'app-prime-performance-tracking',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './prime-performance-tracking.component.html',
  styleUrls: ['./prime-performance-tracking.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrimePerformanceTrackingComponent {
  private dataService = inject(DatabaseService);
  private performanceService = inject(PerformanceService);
  private cdr = inject(ChangeDetectorRef);
  private notificationService = inject(NotificationService);
  private datePipe: DatePipe;

  @ViewChild('chartContainer') chartContainer!: ElementRef;
  @ViewChild('weeklyDeepDiveContainer') weeklyDeepDiveContainer!: ElementRef;
  
  isInitializing = signal(true);
  allProcessedData = signal<Map<string, ProcessedDataset>>(new Map());

  // Filters
  selectedTechnicianId = signal<string>('company_average');
  selectedDatasetIds = signal<Set<string>>(new Set());
  datasetFilterTerm = signal('');
  showWeekSelector = signal(false);

  // All available metrics
  allMetrics: PerformanceMetric[] = [
    { key: 'Total Points', label: 'Total Points' },
    { key: 'TS %', label: 'TS %' },
    { key: 'Positive Completion %', label: 'Pos. Completion' },
    { key: 'On Time %', label: 'On Time %' },
    { key: 'NPS %', label: 'NPS %' },
    { key: 'OSAT', label: 'OSAT' },
    { key: 'SMS Text Compliance %', label: 'SMS Compliance' },
    { key: '7 Day Repeats IN/COS %', label: '7D Reps IN/COS' },
    { key: '7 Day Repeats TC %', label: '7D Reps TC' },
    { key: '30 Day IN/COS Repeat %', label: '30D Reps IN/COS' },
    { key: '30 Day TC Repeat %', label: '30D Reps TC' }
  ];

  // Selected metrics for the line chart
  selectedMetrics = signal<Set<string>>(new Set(['Total Points', 'Positive Completion %', 'NPS %', '7 Day Repeats IN/COS %']));

  // Data for UI
  allTechnicians = computed(() => {
    const techs = new Map<string, string>();
    for (const processed of this.allProcessedData().values()) {
      for (const result of processed.results) {
        const techId = String(result.techData['Tech #']);
        if (!techs.has(techId)) {
          techs.set(techId, result.techData['Name']);
        }
      }
    }
    return Array.from(techs.entries()).map(([id, name]) => ({ id, name })).sort((a,b) => a.name.localeCompare(b.name));
  });

  availableDatasets = computed(() => {
    return Array.from(this.allProcessedData().values())
      .map(pd => pd.dataset)
      .sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
  });

  filteredAvailableDatasets = computed(() => {
    const term = this.datasetFilterTerm().toLowerCase();
    if (!term) return this.availableDatasets();
    return this.availableDatasets().filter(d => 
      new Date(d.uploadDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).toLowerCase().includes(term)
    );
  });
  
  selectedWeeks = computed(() => this.availableDatasets().filter(d => this.selectedDatasetIds().has(d.id)));
  deepDiveWeekId = signal<string | null>(null);

  snapshotTier = computed(() => {
    const weekId = this.deepDiveWeekId();
    if (!weekId) return null;
    const processedDataset = this.allProcessedData().get(weekId);
    if (!processedDataset) return null;
    const targetDate = new Date(processedDataset.dataset.uploadDate);
    const dataForWeek = this.tableData().find(d => d.date.getTime() === targetDate.getTime());
    return dataForWeek?.tier ?? null;
  });

  constructor() {
    this.datePipe = inject(DatePipe);

    effect(() => {
      const datasets = this.dataService.performanceDatasets();
      this.processAllDatasets(datasets);
    });

    effect(() => {
      const data = this.tableData();
      if(this.chartContainer) {
        if(data.length > 0) {
          this.drawChart(data);
        } else {
          this.clearChart();
        }
      }
    });
    effect(() => {
        if(this.selectedWeeks().length > 0 && !this.deepDiveWeekId()) {
            this.deepDiveWeekId.set(this.selectedWeeks()[0]?.id || null);
        }
    });
  }

  private async processAllDatasets(datasets: PerformanceDataset[]) {
    this.isInitializing.set(true);
    const processedMap = new Map<string, ProcessedDataset>();
    const promises = datasets.map(async (dataset) => {
      try {
        const response = await fetch(dataset.dataUrl);
        const blob = await response.blob();
        const { technicians: techsFromFile, companyData } = await this.performanceService.parseAndCleanFile(new File([blob], dataset.fileName));
        
        const validTechsFromFile = techsFromFile.filter(
            (tech: any) => (tech['Jobs'] || 0) > 0 || (tech['TOTAL RATING'] || 0) > 0
        );

        const monthName = new Date(dataset.uploadDate).toLocaleString('en-US', { month: 'long' }).toUpperCase();
        
        const results = validTechsFromFile.map((tech: any) => ({
          techData: tech,
          perfData: this.performanceService.calculatePerformance(tech, monthName)
        }));

        processedMap.set(dataset.id, { dataset, results, companyData });
      } catch (e) {
        console.error(`Failed to process dataset ${dataset.fileName}:`, e);
      }
    });
    await Promise.all(promises);
    this.allProcessedData.set(processedMap);
    
    const currentSelected = this.selectedDatasetIds();
    const validKeys = new Set(processedMap.keys());
    const newSelected = new Set([...currentSelected].filter(id => validKeys.has(id)));

    if (newSelected.size === 0 && processedMap.size > 0) {
        const initialSelected = new Set(Array.from(validKeys).slice(0, 5));
        this.selectedDatasetIds.set(initialSelected);
    } else {
        this.selectedDatasetIds.set(newSelected);
    }

    this.isInitializing.set(false);
    this.cdr.detectChanges();
  }

  private getTier(points: number): string {
    if (points >= 75) return 'Tier 3';
    if (points >= 39) return 'Tier 2';
    if (points >= 0) return 'Tier 1';
    return 'N/A';
  }

  toggleDatasetSelection(id: string, event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedDatasetIds.update(currentSet => {
      if (input.checked) {
        currentSet.add(id);
      } else {
        currentSet.delete(id);
      }
      return new Set(currentSet);
    });
    if(!this.selectedDatasetIds().has(this.deepDiveWeekId()!)) {
        this.deepDiveWeekId.set(this.selectedWeeks()[0]?.id || null);
    }
  }
  
  deselectDataset(id: string): void {
     this.selectedDatasetIds.update(currentSet => {
      currentSet.delete(id);
      return new Set(currentSet);
    });
  }

  toggleMetricSelection(metricKey: string): void {
    this.selectedMetrics.update(currentSet => {
      if (currentSet.has(metricKey)) {
        currentSet.delete(metricKey);
      } else {
        currentSet.add(metricKey);
      }
      return new Set(currentSet);
    });
  }

  tableData = computed<ChartDataPoint[]>(() => {
    const processedData = this.allProcessedData();
    const selectedIds = this.selectedDatasetIds();
    if (processedData.size === 0 || selectedIds.size === 0) return [];

    const dataPoints: ChartDataPoint[] = [];
    const sortedDatasets = this.availableDatasets().filter(d => selectedIds.has(d.id)).reverse();

    for (const dataset of sortedDatasets) {
      const data = processedData.get(dataset.id);
      if (!data) continue;

      let point: ChartDataPoint = { date: new Date(dataset.uploadDate) };
      
      if (this.selectedTechnicianId() === 'company_average') {
        const companyWideTechData = data.companyData;
        
        // If no company data exists for this file, skip it for the company average view.
        if (!companyWideTechData) {
            continue;
        }

        const monthName = new Date(dataset.uploadDate).toLocaleString('en-US', { month: 'long' }).toUpperCase();
        const perfData = this.performanceService.calculatePerformance(companyWideTechData, monthName);
        point['Total Points'] = perfData.total_points;
        point['tier'] = this.getTier(perfData.total_points);
        point['RANK'] = companyWideTechData['RANK'];

        for (const metric of this.allMetrics) {
            if (metric.key !== 'Total Points') {
                point[metric.key] = companyWideTechData[metric.key];
            }
        }
      
      } else {
        const result = data.results.find(r => String(r.techData['Tech #']) === this.selectedTechnicianId());
        if (!result) continue;

        point['Total Points'] = result.perfData.total_points;
        point['tier'] = this.getTier(result.perfData.total_points);
        
        for (const metric of this.allMetrics) {
            if (metric.key === 'Total Points') continue;
            if (metric.key in result.techData) {
                point[metric.key] = result.techData[metric.key];
            }
        }
      }
      dataPoints.push(point);
    }
    return dataPoints;
  });

  kpiSummary = computed(() => {
    const data = this.tableData();
    if (data.length < 1) {
      return this.allMetrics.slice(0, 4).map(m => ({ label: m.label, value: 'N/A', change: 'N/A', isPositiveChange: null, isPercent: m.key.includes('%')}));
    }

    const latest = data[data.length - 1];
    const previous = data.length > 1 ? data[data.length - 2] : null;

    const summary = this.allMetrics.slice(0, 4).map(m => {
      const latestValue = latest[m.key];
      const previousValue = previous ? previous[m.key] : null;
      const isPercent = m.key.includes('%');
      
      let change: number | null = null;
      let isPositiveChange: boolean | null = null;

      if (previousValue !== null && latestValue !== undefined) {
        change = (latestValue - previousValue);
        if(isPercent) change *= 100;

        const lowerIsBetter = m.key.toLowerCase().includes('repeat');
        isPositiveChange = lowerIsBetter ? change < 0 : change > 0;
        if (Math.abs(change) < 0.01) isPositiveChange = null;
      }

      return {
        label: m.label,
        value: latestValue !== undefined ? `${(latestValue * (isPercent ? 100 : 1)).toFixed(1)}${isPercent ? '%' : (m.key.includes('Points') ? ' pts' : '')}` : 'N/A',
        change: change !== null ? change.toFixed(1) : 'N/A',
        isPositiveChange,
        isPercent
      };
    });

    return summary;
  });

  private drawChart(data: ChartDataPoint[]): void {
    if (!this.chartContainer) return;
    const container = this.chartContainer.nativeElement;
    this.clearChart();

    if (data.length === 0) return;

    const selectedMetrics = Array.from(this.selectedMetrics());
    if (selectedMetrics.length === 0) return;

    const margin = { top: 20, right: 150, bottom: 60, left: 50 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    const svg = d3.select(container).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime()
        .domain(d3.extent(data, (d: ChartDataPoint) => d.date) as [Date, Date])
        .range([0, width]);
        
    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x)
            .ticks(Math.min(data.length, 10))
            .tickFormat(d3.timeFormat("%b %d"))
        )
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-45)");

    const yMax = d3.max(data, (d: ChartDataPoint) => {
        return d3.max(selectedMetrics, (metric: string) => {
            const value = d[metric] || 0;
            return metric.includes('%') ? value * 100 : value;
        });
    }) || 100;

    const y = d3.scaleLinear()
        .domain([0, yMax])
        .range([height, 0]);

    svg.append("g").call(d3.axisLeft(y));

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

    selectedMetrics.forEach((metric, i) => {
        colorScale(metric); // Assign color
        
        const lineData = data.filter(d => d[metric] !== undefined && d[metric] !== null);

        if (lineData.length > 1) {
            svg.append("path")
                .datum(lineData)
                .attr("fill", "none")
                .attr("stroke", colorScale(metric))
                .attr("stroke-width", 2)
                .attr("d", d3.line()
                    .x((d: any) => x(d.date))
                    .y((d: any) => y((d[metric] || 0) * (metric.includes('%') ? 100 : 1)))
                );
        }

        svg.selectAll(`.dot-${i}`)
            .data(lineData)
            .enter()
            .append('circle')
            .attr('class', `dot-${i}`)
            .attr('cx', (d: any) => x(d.date))
            .attr('cy', (d: any) => y((d[metric] || 0) * (metric.includes('%') ? 100 : 1)))
            .attr('r', 4)
            .style('fill', colorScale(metric));
    });

    const legend = svg.append("g")
        .attr("transform", `translate(${width + 20}, 0)`);

    selectedMetrics.forEach((metric, i) => {
        const legendItem = legend.append("g")
            .attr("transform", `translate(0, ${i * 20})`);
        
        legendItem.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 10)
            .attr("height", 10)
            .style("fill", colorScale(metric));
        
        legendItem.append("text")
            .attr("x", 15)
            .attr("y", 10)
            .text(metric)
            .style("font-size", "12px")
            .attr("alignment-baseline","middle");
    });
  }

  private clearChart(): void {
      if (this.chartContainer) {
          d3.select(this.chartContainer.nativeElement).selectAll("*").remove();
      }
  }

  deepDiveData = computed(() => {
    const weekId = this.deepDiveWeekId();
    const techId = this.selectedTechnicianId();
    if (!weekId) return null;

    const data = this.allProcessedData().get(weekId);
    if (!data) return null;
    
    if(techId === 'company_average') {
        const companyWideTechData = data.companyData;
        if(!companyWideTechData) return null;
        
        const date = new Date(data.dataset.uploadDate);
        const avgDataPoint = this.tableData().find(p => p.date.getTime() === date.getTime());

        const monthName = new Date(data.dataset.uploadDate).toLocaleString('en-US', { month: 'long' }).toUpperCase();
        const perfData = this.performanceService.calculatePerformance(companyWideTechData, monthName);

        return {
            dataset: data.dataset,
            techData: { ...companyWideTechData, 'Name': 'Company Average', 'Tier': avgDataPoint?.tier, 'RANK': avgDataPoint?.['RANK'] },
            perfData: perfData,
        };
    } else {
        const result = data.results.find(r => String(r.techData['Tech #']) === techId) ?? null;

        if (!result) return null;
        
        return {
          dataset: data.dataset,
          ...result
        };
    }
  });

  snapshotBarChartData = computed(() => {
    const data = this.deepDiveData();
    if (!data) return [];
    
    const formatPercent = (val: number | undefined) => `${((val || 0) * 100).toFixed(1)}%`;

    const rawBars = [
      { label: 'Total Points', value: data.perfData.total_points, isPoints: true, displayValue: `${data.perfData.total_points} pts` },
      { label: 'TS%', value: (data.techData['TS %'] || 0) * 100, isPercent: true, displayValue: formatPercent(data.techData['TS %']) },
      { label: 'Pos. Comp %', value: (data.techData['Positive Completion %'] || 0) * 100, isPercent: true, displayValue: formatPercent(data.techData['Positive Completion %']) },
      { label: 'On Time %', value: (data.techData['On Time %'] || 0) * 100, isPercent: true, displayValue: formatPercent(data.techData['On Time %']) },
      { label: 'NPS %', value: (data.techData['NPS %'] || 0) * 100, isPercent: true, displayValue: formatPercent(data.techData['NPS %']) },
      { label: 'OSAT', value: data.techData['OSAT'] || 0, isOSAT: true, displayValue: `${(data.techData['OSAT'] || 0).toFixed(1)}` },
      { label: 'SMS %', value: (data.techData['SMS Text Compliance %'] || 0) * 100, isPercent: true, displayValue: formatPercent(data.techData['SMS Text Compliance %']) },
      { label: '7D IN/COS', value: (data.techData['7 Day Repeats IN/COS %'] || 0) * 100, isPercent: true, displayValue: formatPercent(data.techData['7 Day Repeats IN/COS %']) },
      { label: '7D TC', value: (data.techData['7 Day Repeats TC %'] || 0) * 100, isPercent: true, displayValue: formatPercent(data.techData['7 Day Repeats TC %']) },
      { label: '30D IN/COS', value: (data.techData['30 Day IN/COS Repeat %'] || 0) * 100, isPercent: true, displayValue: formatPercent(data.techData['30 Day IN/COS Repeat %']) },
      { label: '30D TC', value: (data.techData['30 Day TC Repeat %'] || 0) * 100, isPercent: true, displayValue: formatPercent(data.techData['30 Day TC Repeat %']) },
    ];
    
    return rawBars.map(bar => {
      let height = 0;
      if (bar.isPoints) {
        height = bar.value / 105 * 100;
      } else if (bar.isOSAT) {
        height = bar.value * 10;
      } else if (bar.isPercent) {
        height = bar.value;
      }

      // Ensure height is a valid number, default to 0 if not
      const numericHeight = isNaN(height) ? 0 : height;

      return {
          ...bar,
          height: Math.min(100, numericHeight)
      };
    });
  });
  
  weeklyPerformers = computed(() => {
      const weekId = this.deepDiveWeekId();
      if (!weekId) return null;
      const data = this.allProcessedData().get(weekId);
      if (!data || data.results.length < 5) return null;

      const sorted = [...data.results].sort((a,b) => b.perfData.total_points - a.perfData.total_points);
      return {
          top: sorted.slice(0, 5),
          bottom: sorted.slice(-5).reverse()
      };
  });

  technicianBreakdown = computed(() => {
    const weekId = this.deepDiveWeekId();
    if (!weekId) return [];
    const data = this.allProcessedData().get(weekId);
    if (!data) return [];
    
    return data.results.map(r => {
      const row: { [key: string]: any } = {
        techId: String(r.techData['Tech #']),
        name: r.techData['Name']
      };
      for (const metric of this.allMetrics) {
        if (metric.key === 'Total Points') {
          row[metric.key] = r.perfData.total_points;
        } else {
            const value = r.techData[metric.key];
            row[metric.key] = typeof value === 'number' ? value : 0;
        }
      }
      return row;
    }).sort((a,b) => a.name.localeCompare(b.name));
  });

  async exportSnapshot(): Promise<void> {
    const element = this.weeklyDeepDiveContainer.nativeElement;
    if (!element) return;
    try {
      const canvas = await html2canvas(element, { scale: 2 });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      const techName = this.deepDiveData()?.techData['Name'].replace(/\s/g, '_') || 'snapshot';
      const weekDate = this.datePipe.transform(this.deepDiveData()?.dataset?.uploadDate || new Date(), 'yyyy-MM-dd');
      a.download = `Performance_Snapshot_${techName}_${weekDate}.png`;
      a.click();
    } catch(e) {
      console.error("Failed to export snapshot", e);
      this.notificationService.showError("Could not generate snapshot image.");
    }
  }
  
  downloadTableAsExcel(): void {
    const data = this.tableData();
    if (data.length === 0) return;
    
    const formattedData = data.map(row => {
        const newRow: {[key: string]: any} = {
            'Week': this.datePipe.transform(row.date, 'mediumDate'),
            'Tier': row.tier
        };
        this.allMetrics.forEach(metric => {
            const value = row[metric.key];
            if (value !== undefined && value !== null) {
                newRow[metric.label] = metric.key.includes('%') ? value * 100 : value;
            } else {
                newRow[metric.label] = 'N/A';
            }
        });
        return newRow;
    });

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Performance Trend');
    XLSX.writeFile(workbook, 'performance_trend.xlsx');
  }
  
  downloadTechnicianBreakdownAsExcel(): void {
    const data = this.technicianBreakdown();
    if (data.length === 0) return;
    
    const formattedData = data.map(row => {
        const newRow: {[key: string]: any} = {
            'Name': row.name
        };
        this.allMetrics.forEach(metric => {
            const value = row[metric.key];
            if (value !== undefined && value !== null) {
                 newRow[metric.label] = metric.key.includes('%') ? value * 100 : value;
            } else {
                newRow[metric.label] = 'N/A';
            }
        });
        return newRow;
    });

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Technician Breakdown');
    XLSX.writeFile(workbook, 'technician_breakdown.xlsx');
  }

}