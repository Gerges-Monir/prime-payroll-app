import { Component, ChangeDetectionStrategy, input, output, inject, computed } from '@angular/core';
import { UiStateService } from '../../../services/ui-state.service';
import { SettingsService } from '../../../services/settings.service';


@Component({
  selector: 'app-dashboard-header',
  standalone: true,
  templateUrl: './dashboard-header.component.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderComponent {
  private uiStateService = inject(UiStateService);
  private settingsService = inject(SettingsService);
  
  pageTitle = input.required<string>();
  description = input<string>();
  showLogout = input<boolean>(false);
  
  logout = output<void>();
  logoClicked = output<void>();

  logo = computed(() => this.settingsService.settings().logoUrl);

  toggleSidebar(): void {
    this.uiStateService.sidebarOpen.update(v => !v);
  }
}