import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { CareerApplication } from '../../models/payroll.model';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';
import { NotificationService } from '../../services/notification.service';

type SortField = 'submissionDate' | 'name';

@Component({
  selector: 'app-applications',
  standalone: true,
  imports: [CommonModule, DatePipe, ConfirmationModalComponent],
  templateUrl: './applications.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationsComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);

  applications = this.dataService.careerApplications;

  // State for filtering, sorting, and UI
  filterTerm = signal('');
  sortField = signal<SortField>('submissionDate');
  sortDirection = signal<'asc' | 'desc'>('desc');
  expandedApplicationId = signal<string | null>(null);

  // New signals for delete confirmation
  showDeleteConfirm = signal(false);
  applicationToDelete = signal<CareerApplication | null>(null);

  filteredAndSortedApplications = computed(() => {
    let apps = [...this.applications()];
    const term = this.filterTerm().toLowerCase();

    // Filtering
    if (term) {
      apps = apps.filter(app => 
        app.name.toLowerCase().includes(term) ||
        app.email.toLowerCase().includes(term) ||
        app.position.toLowerCase().includes(term)
      );
    }

    // Sorting
    const field = this.sortField();
    const dir = this.sortDirection();
    apps.sort((a, b) => {
      let comparison = 0;
      if (field === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else { // 'submissionDate'
        comparison = new Date(b.submissionDate).getTime() - new Date(a.submissionDate).getTime();
      }
      return dir === 'asc' ? -comparison : comparison;
    });

    return apps;
  });

  toggleSort(field: SortField) {
    if (this.sortField() === field) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('desc'); // Default to descending for new field
    }
  }
  
  onFilter(event: Event) {
    this.filterTerm.set((event.target as HTMLInputElement).value);
  }

  toggleDetails(appId: string) {
    this.expandedApplicationId.update(current => current === appId ? null : appId);
  }

  deleteApplication(app: CareerApplication): void {
    this.applicationToDelete.set(app);
    this.showDeleteConfirm.set(true);
  }

  async handleDelete(confirmed: boolean): Promise<void> {
    const app = this.applicationToDelete();
    this.showDeleteConfirm.set(false);

    if (confirmed && app) {
      try {
        await this.dataService.deleteCareerApplication(app.id);
        this.notificationService.showSuccess(`Application from '${app.name}' deleted successfully.`);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        this.notificationService.showError(errorMessage);
      }
    }
    this.applicationToDelete.set(null);
  }
}