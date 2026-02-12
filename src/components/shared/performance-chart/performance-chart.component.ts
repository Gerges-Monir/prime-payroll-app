import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-performance-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './performance-chart.component.html',
  styleUrls: ['./performance-chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerformanceChartComponent {
  techData = input.required<any>();
  perfData = input.required<any>();
  notes = input<string>();

  private readonly metricLabelMap: { [key: string]: string[] } = {
    'TS': ['TS %'],
    'Pos Comp': ['Positive Completion %'],
    'On Time': ['On Time %'],
    'NPS': ['NPS %'],
    'OSAT': ['OSAT'],
    'SMS': ['SMS Text Compliance %'],
    '7D Reps IN/COS': ['7 Day Repeats IN/COS %'],
    '7D Reps TC': ['7 Day Repeats TC %'],
    '30D IN/COS': ['30 Day IN/COS Repeat %'],
    '30D TC': ['30 Day TC Repeat %'],
  };
  
  getMetricData(shortLabel: string): { key: string, value: { actual: number, points: number, max: number } } | null {
    const possibleKeys = this.metricLabelMap[shortLabel] || [];
    for (const key of possibleKeys) {
      const metricData = this.perfData().detailed.find((d: any) => d.key === key);
      if (metricData) {
        return metricData;
      }
    }
    return null;
  }
}
