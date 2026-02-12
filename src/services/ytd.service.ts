import { Injectable, inject } from '@angular/core';
import { DatabaseService } from './database.service';
import { PublishedPayroll } from '../models/payroll.model';

@Injectable({
  providedIn: 'root',
})
export class YtdService {
  private dataService = inject(DatabaseService);

  getAvailableYears(): number[] {
    const payrolls = this.dataService.publishedPayrolls();
    if (payrolls.length === 0) {
      return [new Date().getFullYear()];
    }
    const years = new Set(payrolls.map(p => new Date(p.endDate).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }

  calculateUserYTD(userId: string, year: number): number {
    const allPayrolls = this.dataService.publishedPayrolls();
    let ytdInCents = 0;

    const filteredPayrolls = allPayrolls.filter(p => new Date(p.endDate).getFullYear() === year);

    for (const payroll of filteredPayrolls) {
      const techReport = payroll.reportData.find(r => r.id === userId);
      if (techReport) {
        ytdInCents += Math.round((techReport.totalEarnings || 0) * 100);
      }
    }

    // Add taxable loans
    const user = this.dataService.users().find(u => u.id === userId);
    if (user) {
      const taxableLoans = this.dataService.loans().filter(
        loan => loan.techId === user.techId && 
                loan.isTaxable && 
                new Date(loan.date).getFullYear() === year
      );
      const loanTotalInCents = taxableLoans.reduce((sum, loan) => sum + Math.round((loan.totalAmount || 0) * 100), 0);
      ytdInCents += loanTotalInCents;
    }

    return ytdInCents / 100;
  }

  calculateCompanyYTD(managerId: string, year: number): { total: number; includedUserIds: string[] } {
    const allUsers = this.dataService.users();
    const teamMembers = allUsers.filter(u => u.assignedTo === managerId);
    const includedUserIds = [managerId, ...teamMembers.map(u => u.id)];
    
    let totalYtdInCents = 0;
    for (const userId of includedUserIds) {
      totalYtdInCents += Math.round(this.calculateUserYTD(userId, year) * 100);
    }

    return { total: totalYtdInCents / 100, includedUserIds };
  }
}