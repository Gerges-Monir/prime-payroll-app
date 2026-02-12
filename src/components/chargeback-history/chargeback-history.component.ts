import { Component, ChangeDetectionStrategy, inject, computed, signal, input } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { User, ChargebackReport } from '../../models/payroll.model';

interface MonthOption {
  id: string; // YYYY-MM
  display: string;
}

@Component({
  selector: 'app-chargeback-history',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe],
  templateUrl: './chargeback-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChargebackHistoryComponent {
  private dataService = inject(DatabaseService);

  userId = input<string | null>(null);

  isUserView = computed(() => this.userId() !== null);
  userMap = computed(() => new Map(this.dataService.users().map(u => [u.id, u])));

  allPublishedReports = computed(() => {
    const reports = this.dataService.chargebackReports().filter(r => r.status === 'published');
    const targetUserId = this.userId();
    if (targetUserId) {
      return reports.filter(r => r.userId === targetUserId);
    }
    return reports;
  });

  availableMonths = computed<MonthOption[]>(() => {
    const monthIdentifiers = new Set<string>();
    this.allPublishedReports().forEach(report => {
        monthIdentifiers.add(report.monthIdentifier);
    });

    return Array.from(monthIdentifiers).map(monthId => {
      const [year, month] = monthId.split('-');
      const date = new Date(Number(year), Number(month) - 1, 1);
      return { 
        id: monthId, 
        display: date.toLocaleString('en-US', { month: 'long', year: 'numeric' })
      };
    }).sort((a, b) => b.id.localeCompare(a.id));
  });
  
  // Filters
  selectedMonth = signal<string>('');
  userNameFilter = signal('');

  filteredReports = computed(() => {
    let reports = this.allPublishedReports();

    if (this.selectedMonth()) {
      reports = reports.filter(r => r.monthIdentifier === this.selectedMonth());
    }

    if (!this.isUserView() && this.userNameFilter()) {
      const term = this.userNameFilter().toLowerCase();
      reports = reports.filter(r => {
        const user = this.userMap().get(r.userId);
        return user?.name.toLowerCase().includes(term);
      });
    }

    return reports.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
  });

  downloadFile(report: ChargebackReport): void {
    const a = document.createElement('a');
    a.href = report.fileDataUrl;
    a.download = report.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}