import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { SubAdminDashboardComponent } from './components/sub-admin-dashboard/sub-admin-dashboard.component';
import { EmployeeDashboardComponent } from './components/employee-dashboard/employee-dashboard.component';
import { SupervisorDashboardComponent } from './components/supervisor-dashboard/supervisor-dashboard.component';
import { LoginComponent } from './components/login/login.component';
import { AuthService } from './services/auth.service';
import { NotificationComponent } from './components/shared/notification/notification.component';
import { LandingComponent } from './components/landing/landing.component';
import { DatabaseService } from './services/database.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  imports: [
    CommonModule,
    AdminDashboardComponent,
    SubAdminDashboardComponent,
    EmployeeDashboardComponent,
    SupervisorDashboardComponent,
    LoginComponent,
    NotificationComponent,
    LandingComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  private authService = inject(AuthService);
  private databaseService = inject(DatabaseService);
  private themeService = inject(ThemeService); // Initialize theme service
  
  currentUser = this.authService.currentUser;
  isInitializing = this.authService.isInitializing;
  isConfigured = this.authService.isConfigured;
  connectionError = this.databaseService.publicConnectionError;
  firebaseError = this.authService.firebaseError;
  showLogin = signal(false);

  ngOnInit() {
    // Initialization is now handled by the AuthService constructor
    // to check the user's auth state as soon as the app loads.
  }
}