import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { DatabaseService } from '../../services/database.service';
import { SettingsService, AppSettings } from '../../services/settings.service';
import { YtdService } from '../../services/ytd.service';
import { User } from '../../models/payroll.model';
import { Form1099Component, Recipient1099, Payer1099 } from '../form-1099/form-1099.component';

@Component({
  selector: 'app-tax-forms',
  standalone: true,
  imports: [CommonModule, FormsModule, Form1099Component],
  templateUrl: './tax-forms.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxFormsComponent implements OnInit {
  private authService = inject(AuthService);
  private dataService = inject(DatabaseService);
  private settingsService = inject(SettingsService);
  private ytdService = inject(YtdService);
  // FIX: Inject DatePipe in the constructor to ensure proper type inference.
  private datePipe: DatePipe;

  currentUser = this.authService.currentUser;
  
  // Admin-specific state
  allUsersForDropdown = computed(() => this.dataService.users().filter(u => u.role !== 'admin').sort((a,b) => a.name.localeCompare(b.name)));
  selectedUserIdForAdmin = signal<string | null>(null);

  // Team-specific state
  viewModeForTeam = signal<'personal' | 'company'>('personal');
  
  availableYears = this.ytdService.getAvailableYears();
  selectedYear = signal<number>(this.availableYears[0] || new Date().getFullYear());

  showDetailsModal = signal(false);

  payerInfo = computed<Payer1099>(() => {
    const settings = this.settingsService.settings();
    return {
      logoUrl: settings.logoUrl,
      name: settings.companyName,
      tin: '99-2045424', // This should be stored in settings eventually
      address: `${settings.companyAddress1}\n${settings.companyAddress2}`,
    };
  });

  recipientInfo = computed<Recipient1099 | null>(() => {
    const role = this.currentUser()?.role;
    let targetUser: User | undefined;

    if (role === 'admin') {
      if (!this.selectedUserIdForAdmin()) return null;
      targetUser = this.dataService.users().find(u => u.id === this.selectedUserIdForAdmin());
    } else {
      targetUser = this.currentUser()!;
    }
    
    if (!targetUser) return null;

    // Handle company view for team leads
    if ((role === 'supervisor' || role === 'sub-admin') && this.viewModeForTeam() === 'company') {
       const subAdminSettings = this.dataService.subAdminSettings().find(s => s.subAdminId === targetUser!.id);
       return {
         name: subAdminSettings?.companyName || `${targetUser.name}'s Team`,
         tin: targetUser.tin, // Assuming company uses manager's TIN
         address: `${subAdminSettings?.companyAddress1 || targetUser.addressLine1 || ''}\n${subAdminSettings?.companyAddress2 || ''}`,
         fullAddress: `${subAdminSettings?.companyAddress1 || targetUser.addressLine1 || ''}, ${targetUser.city || ''}, ${targetUser.state || ''} ${targetUser.zipCode || ''}`
       };
    }

    return {
      name: targetUser.name,
      tin: targetUser.tin,
      address: `${targetUser.addressLine1 || ''}\n${targetUser.addressLine2 || ''}`,
      fullAddress: `${targetUser.addressLine1 || ''}, ${targetUser.city || ''}, ${targetUser.state || ''} ${targetUser.zipCode || ''}`
    };
  });

  compensation = computed<number>(() => {
    const role = this.currentUser()?.role;
    const year = this.selectedYear();
    let targetUserId: string | null = null;
    
    if (role === 'admin') {
      targetUserId = this.selectedUserIdForAdmin();
    } else {
      targetUserId = this.currentUser()!.id;
    }

    if (!targetUserId) return 0;
    
    if ((role === 'supervisor' || role === 'sub-admin') && this.viewModeForTeam() === 'company') {
      return this.ytdService.calculateCompanyYTD(targetUserId, year).total;
    }

    return this.ytdService.calculateUserYTD(targetUserId, year);
  });
  
  paymentDetails = computed(() => {
    const role = this.currentUser()?.role;
    const year = this.selectedYear();
    let includedUserIds: string[] = [];
    
    // Determine which users' data to include
    if (role === 'admin') {
      const adminSelectedId = this.selectedUserIdForAdmin();
      if (adminSelectedId) includedUserIds = [adminSelectedId];
    } else if (role === 'employee') {
      includedUserIds = [this.currentUser()!.id];
    } else if (role === 'supervisor' || role === 'sub-admin') {
      if (this.viewModeForTeam() === 'company') {
        const companyData = this.ytdService.calculateCompanyYTD(this.currentUser()!.id, year);
        includedUserIds = companyData.includedUserIds;
      } else {
        includedUserIds = [this.currentUser()!.id];
      }
    }

    if (includedUserIds.length === 0) return [];

    const allPayrollsInYear = this.dataService.publishedPayrolls().filter(p => new Date(p.endDate).getFullYear() === year);

    // 1. Get payroll-based payments
    const payrollPayments = allPayrollsInYear.map(payroll => {
      const weeklyAmount = payroll.reportData
        .filter(report => includedUserIds.includes(report.id))
        .reduce((sum, report) => sum + report.totalEarnings, 0);

      return {
        id: payroll.id,
        week: `Payroll: ${this.datePipe.transform(payroll.startDate, 'MMM d')} - ${this.datePipe.transform(payroll.endDate, 'MMM d, y')}`,
        amount: weeklyAmount,
        date: this.dataService.parseDateAsUTC(payroll.endDate),
      };
    });

    // 2. Get taxable loan payments
    const userMap = new Map(this.dataService.users().map(u => [u.id, u.techId]));
    const includedTechIds = new Set(includedUserIds.map(id => userMap.get(id)).filter(Boolean));

    const loanPayments = this.dataService.loans()
      .filter(loan => 
        loan.isTaxable && 
        includedTechIds.has(loan.techId) &&
        new Date(loan.date).getFullYear() === year
      )
      .map(loan => ({
        id: loan.id,
        week: `Taxable Loan: ${loan.description}`,
        amount: loan.totalAmount,
        date: this.dataService.parseDateAsUTC(loan.date)
      }));

    // 3. Combine and sort
    const allPayments = [...payrollPayments, ...loanPayments]
      .filter(p => p.amount > 0)
      .sort((a, b) => b.date.getTime() - a.date.getTime()); // show most recent first

    return allPayments;
  });

  constructor() {
    this.datePipe = inject(DatePipe);
  }

  ngOnInit() {
    if (this.allUsersForDropdown().length > 0 && this.currentUser()?.role === 'admin') {
        this.selectedUserIdForAdmin.set(this.allUsersForDropdown()[0].id);
    }
  }
}