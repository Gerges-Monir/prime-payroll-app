import { Component, ChangeDetectionStrategy, input, output, inject } from '@angular/core';
import { UiStateService } from '../../../services/ui-state.service';

@Component({
  selector: 'app-dashboard-header',
  standalone: true,
  templateUrl: './dashboard-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderComponent {
  private uiStateService = inject(UiStateService);
  
  pageTitle = input.required<string>();
  description = input<string>();
  showLogout = input<boolean>(false);
  
  logout = output<void>();

  toggleSidebar(): void {
    this.uiStateService.sidebarOpen.update(v => !v);
  }
}
