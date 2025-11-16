import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

@Component({
  selector: 'app-dashboard-header',
  standalone: true,
  templateUrl: './dashboard-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderComponent {
  title = input.required<string>();
  subtitle = input.required<string>();
  logout = output<void>();

  onLogout(): void {
    this.logout.emit();
  }
}