import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { SubAdminDashboardComponent } from './components/sub-admin-dashboard/sub-admin-dashboard.component';
import { EmployeeDashboardComponent } from './components/employee-dashboard/employee-dashboard.component';
import { LoginComponent } from './components/login/login.component';
import { AuthService } from './services/auth.service';
import { DatabaseService } from './services/database.service';
import { NotificationComponent } from './components/shared/notification/notification.component';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  imports: [
    CommonModule,
    AdminDashboardComponent,
    SubAdminDashboardComponent,
    EmployeeDashboardComponent,
    LoginComponent,
    NotificationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  private authService = inject(AuthService);
  private dataService = inject(DatabaseService);
  
  currentUser = this.authService.currentUser;
  isInitializing = signal(true);

  async ngOnInit() {
    try {
      await this.dataService.initialize();
    } catch (error) {
      console.error("Failed to initialize data service", error);
      // Optionally show an error message to the user
    } finally {
      this.isInitializing.set(false);
    }
  }
}
