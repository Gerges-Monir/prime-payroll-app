import { Component, ChangeDetectionStrategy, input, output, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../services/auth.service';
import { UiStateService } from '../../../services/ui-state.service';
import { SettingsService } from '../../../services/settings.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  private authService = inject(AuthService);
  private uiStateService = inject(UiStateService);
  private settingsService = inject(SettingsService);
  
  tabs = input.required<{id: string, name: string, icon: string}[]>();
  activeTab = input.required<string>();
  tabSelected = output<any>();
  logout = output<void>();

  logo = computed(() => this.settingsService.settings().logoUrl);
  currentUser = this.authService.currentUser;
  sidebarOpen = this.uiStateService.sidebarOpen;

  selectTab(tabId: string): void {
    this.tabSelected.emit(tabId);
    // Close sidebar on navigation in mobile
    if (window.innerWidth < 768) {
      this.uiStateService.sidebarOpen.set(false);
    }
  }

  closeSidebar(): void {
     this.uiStateService.sidebarOpen.set(false);
  }

  onLogout(): void {
    this.logout.emit();
  }

  getInitials(name: string | undefined): string {
    if (!name) return '';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }
}
