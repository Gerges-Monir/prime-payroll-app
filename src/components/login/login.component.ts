import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
  imports: [CommonModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private authService = inject(AuthService);
  private fb: FormBuilder;

  loginForm: FormGroup;
  loginError = signal<string | null>(null);
  isLoading = signal(false);

  constructor() {
    this.fb = inject(FormBuilder);
    this.loginForm = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      return;
    }
    this.isLoading.set(true);
    this.loginError.set(null);
    
    const { username, password } = this.loginForm.value;

    // Simulate network delay
    setTimeout(() => {
      const result = this.authService.login(username, password);
      if (!result.success) {
        this.loginError.set(result.message || 'Login failed.');
      }
      this.isLoading.set(false);
    }, 500);
  }
}