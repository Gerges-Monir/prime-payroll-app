import { Component, ChangeDetectionStrategy, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { SettingsService } from '../../services/settings.service';


@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
  styleUrls: ['../../styles/login.css'],
  imports: [CommonModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private authService = inject(AuthService);
  private settingsService = inject(SettingsService);
  private fb: FormBuilder;

  showLanding = output<void>();

  logo = computed(() => this.settingsService.settings().logoUrl);
  companyEmail = computed(() => this.settingsService.settings().companyEmail);
  
  // View management
  view = signal<'login' | 'forgotPassword'>('login');

  // Login state
  loginForm: FormGroup;
  loginError = signal<string | null>(null);
  isLoading = signal(false);

  // Forgot Password state
  forgotPasswordForm: FormGroup;
  isSendingReset = signal(false);
  resetMessage = signal('');
  resetSuccess = signal(false);

  constructor() {
    this.fb = inject(FormBuilder);
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
    });
    this.forgotPasswordForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  async onLoginSubmit(): Promise<void> {
    if (this.loginForm.invalid) {
      return;
    }
    this.isLoading.set(true);
    this.loginError.set(null);
    
    const { email, password } = this.loginForm.value;

    try {
      const result = await this.authService.login(email, password);
      if (!result.success) {
        this.loginError.set(result.message || 'Login failed.');
      }
      // On success, the auth service will automatically navigate to the dashboard
    } catch (error) {
      this.loginError.set('An unexpected error occurred.');
      console.error('Login error', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async onForgotPasswordSubmit(): Promise<void> {
    if (this.forgotPasswordForm.invalid) {
      return;
    }
    this.isSendingReset.set(true);
    this.resetMessage.set('');
    this.resetSuccess.set(false);

    const { email } = this.forgotPasswordForm.value;

    try {
      const result = await this.authService.sendPasswordResetEmail(email);
      if (result.success) {
        this.resetSuccess.set(true);
        this.resetMessage.set(`A password reset link has been sent to ${email}. Please check your inbox.`);
      } else {
        this.resetSuccess.set(false);
        this.resetMessage.set(result.message || 'Failed to send reset email. Please try again.');
      }
    } catch (error) {
      this.resetSuccess.set(false);
      this.resetMessage.set('An unexpected error occurred.');
      console.error('Password reset error', error);
    } finally {
      this.isSendingReset.set(false);
    }
  }

  switchToLogin(): void {
    this.view.set('login');
    this.resetMessage.set('');
    this.resetSuccess.set(false);
    this.forgotPasswordForm.reset();
  }
}