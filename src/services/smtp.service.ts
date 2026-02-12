import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from './settings.service';
import { NotificationService } from './notification.service';
import { User } from '../models/payroll.model';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { environment } from '../environments/environment';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class SmtpService {
  private http: HttpClient = inject(HttpClient);
  private settingsService: SettingsService = inject(SettingsService);
  private notificationService: NotificationService = inject(NotificationService);
  private currencyPipe: CurrencyPipe = inject(CurrencyPipe);
  private datePipe: DatePipe = inject(DatePipe);
  private authService: AuthService = inject(AuthService);

  private get functionUrl(): string {
    return environment.cloudFunctionUrl;
  }

  private isConfigured(): boolean {
    const url = this.functionUrl;
    const isMisconfigured = !url || url === 'PASTE_YOUR_CLOUD_FUNCTION_TRIGGER_URL_HERE';
      
    if (isMisconfigured) {
      this.notificationService.show(
        'Email sending is not configured. The administrator must set the Cloud Function URL in the environment file.',
        'error',
        10000
      );
      return false;
    }
    return true;
  }
  
  private async sendEmail(to: string, subject: string, html: string, requiresAuth: boolean): Promise<boolean> {
    if (!this.isConfigured()) return false;
    
    let headers = new HttpHeaders({
      'Content-Type': 'application/json',
    });

    if (requiresAuth) {
      const token = await this.authService.getIdToken();
      if (!token) {
          this.notificationService.showError('You are not authenticated. Could not send email.');
          return false;
      }
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    
    try {
        await firstValueFrom(this.http.post(this.functionUrl, { to, subject, html }, { headers, responseType: 'text' }));
        return true;
    } catch (error) {
        console.error('Error sending email via Cloud Function:', error);
        this.notificationService.showError('Failed to send email. The email server may be misconfigured or unavailable.');
        return false;
    }
  }

  async sendContactMessage(fromName: string, fromEmail: string, subject: string, message: string): Promise<boolean> {
    const settings = this.settingsService.settings();
    const to = settings.companyEmail;

    const emailHtml = `
      <p>You have received a new message from your website's contact form.</p>
      <ul>
          <li><strong>From:</strong> ${fromName} (${fromEmail})</li>
          <li><strong>Subject:</strong> ${subject}</li>
      </ul>
      <hr>
      <p><strong>Message:</strong></p>
      <p style="white-space: pre-wrap;">${message}</p>
    `;

    const success = await this.sendEmail(to, `New Contact Form Submission: ${subject}`, emailHtml, false);
    if(success) {
        this.notificationService.showSuccess('Your message has been sent successfully!');
    }
    return success;
  }

  async sendCareerApplication(applicationData: any): Promise<boolean> {
    const settings = this.settingsService.settings();
    const to = settings.companyEmail;
    const subject = `New Job Application for ${applicationData.position} from ${applicationData.name}`;

    const emailHtml = `
      <p>A new application has been submitted for the position of <strong>${applicationData.position}</strong>.</p>
      <ul>
          <li><strong>Applicant:</strong> ${applicationData.name}</li>
          <li><strong>Email:</strong> ${applicationData.email}</li>
          <li><strong>Phone:</strong> ${applicationData.phone}</li>
      </ul>
      <p>Log in to the admin dashboard to view the full application details.</p>
    `;

    return this.sendEmail(to, subject, emailHtml, false);
  }

  async sendPaystub(user: User, paystubData: any): Promise<void> {
    const settings = this.settingsService.settings();
    if (!user || !user.email?.trim() || user.email.includes('@primecommunication.com')) {
      const userName = user?.name || 'the selected employee';
      this.notificationService.showError(
        `Cannot send email. ${userName} has an invalid or placeholder email address. Please update their profile.`
      );
      return;
    }
    
    const subject = `Your Paystub from ${settings.companyName} for ${this.datePipe.transform(paystubData.report.startDate, 'mediumDate')} - ${this.datePipe.transform(paystubData.report.endDate, 'mediumDate')}`;
    const emailHtml = `
      <h3>Hi ${user.name},</h3>
      <p>Your paystub for the period of ${this.datePipe.transform(paystubData.report.startDate, 'mediumDate')} - ${this.datePipe.transform(paystubData.report.endDate, 'mediumDate')} is ready.</p>
      <ul>
          <li><strong>Gross Earnings:</strong> ${this.currencyPipe.transform(paystubData.grossEarnings)}</li>
          <li><strong>Total Deductions:</strong> ${this.currencyPipe.transform(paystubData.totalDeductions)}</li>
          <li><strong>Net Pay:</strong> <strong>${this.currencyPipe.transform(paystubData.netPay)}</strong></li>
      </ul>
      <p>You can view the full details by logging into your employee dashboard.</p>
      <p>Thank you,<br>${settings.companyName}</p>
    `;

    const success = await this.sendEmail(user.email, subject, emailHtml, true);
    if (success) {
      this.notificationService.showSuccess(`Paystub email successfully sent to ${user.name}.`);
    }
  }
}
