import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { User } from '../../models/payroll.model';

type ViewMode = 'weekly' | 'ytd';
type EntityType = 'Employee' | 'Company';

interface SummaryEntity {
  id: string;
  name: string;
  type: EntityType;
  payout: number;
  user: User;
}

interface YtdEntity {
  id: string;
  name: string;
  type: EntityType;
  ytdPayout: number;
  weeklyBreakdown: { week: string; amount: number }[];
  user: User;
}


@Component({
  selector: 'app-payroll-summary',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe],
  templateUrl: './payroll-summary.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayrollSummaryComponent {
  private dataService = inject(DatabaseService);
  
  viewMode = signal<ViewMode>('weekly');
  
  // Weekly View State
  payrolls = computed(() => this.dataService.publishedPayrolls().sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()));
  selectedPayrollId = signal<string | null>(null);

  // YTD View State
  showYtdDrilldown = signal<YtdEntity | null>(null);
  
  // Shared State
  filterTerm = signal('');

  constructor() {
    // Auto-select the first payroll if available
    if (this.payrolls().length > 0) {
      this.selectedPayrollId.set(this.payrolls()[0].id);
    }
  }

  weeklySummary = computed<SummaryEntity[]>(() => {
    const payrollId = this.selectedPayrollId();
    if (!payrollId) return [];

    const payroll = this.payrolls().find(p => p.id === payrollId);
    if (!payroll) return [];

    const allUsers = this.dataService.users();
    const subAdmins = allUsers.filter(u => u.role === 'sub-admin');
    const teamMembersBySubAdmin = new Map<string, string[]>();
    
    subAdmins.forEach(sa => {
      const teamIds = allUsers.filter(u => u.assignedTo === sa.id).map(u => u.id);
      teamMembersBySubAdmin.set(sa.id, teamIds);
    });

    const entities: SummaryEntity[] = [];
    const processedUserIds = new Set<string>();

    // Process companies (sub-admins and their teams)
    subAdmins.forEach(sa => {
      const teamIds = teamMembersBySubAdmin.get(sa.id) ?? [];
      const companyMemberIds = [sa.id, ...teamIds];
      let companyPayout = 0;
      
      payroll.reportData.forEach(techReport => {
        if (companyMemberIds.includes(techReport.id)) {
          companyPayout += techReport.totalEarnings;
          processedUserIds.add(techReport.id);
        }
      });
      
      if (companyPayout > 0 || payroll.reportData.some(r => r.id === sa.id)) {
        entities.push({ id: sa.id, name: `${sa.name}'s Team`, type: 'Company', payout: companyPayout, user: sa });
      }
    });

    // Process individual employees
    payroll.reportData.forEach(techReport => {
      if (!processedUserIds.has(techReport.id)) {
        const user = allUsers.find(u => u.id === techReport.id);
        if (user) {
          entities.push({ id: user.id, name: user.name, type: 'Employee', payout: techReport.totalEarnings, user });
        }
      }
    });

    return entities.sort((a, b) => a.name.localeCompare(b.name));
  });

  ytdSummary = computed<YtdEntity[]>(() => {
    const allUsers = this.dataService.users();
    const subAdmins = allUsers.filter(u => u.role === 'sub-admin');
    const teamMembersBySubAdmin = new Map<string, string[]>();
     subAdmins.forEach(sa => {
      const teamIds = allUsers.filter(u => u.assignedTo === sa.id).map(u => u.id);
      teamMembersBySubAdmin.set(sa.id, teamIds);
    });

    const ytdMap = new Map<string, YtdEntity>();

    // Initialize entities
    allUsers.forEach(u => {
      if(u.role === 'admin') return;

      if(u.role === 'sub-admin') {
         ytdMap.set(u.id, { id: u.id, name: `${u.name}'s Team`, type: 'Company', ytdPayout: 0, weeklyBreakdown: [], user: u });
      } else if (!u.assignedTo) {
         ytdMap.set(u.id, { id: u.id, name: u.name, type: 'Employee', ytdPayout: 0, weeklyBreakdown: [], user: u });
      }
    });

    // Aggregate data from all payrolls
    this.payrolls().forEach(payroll => {
      const weekLabel = `${payroll.startDate} to ${payroll.endDate}`;
      const weeklyPayouts = new Map<string, number>(); // entityId -> weekly payout

      // Aggregate weekly payouts for companies
      subAdmins.forEach(sa => {
        const teamIds = teamMembersBySubAdmin.get(sa.id) ?? [];
        const companyMemberIds = [sa.id, ...teamIds];
        let companyPayout = 0;
        payroll.reportData.forEach(techReport => {
          if (companyMemberIds.includes(techReport.id)) {
            companyPayout += techReport.totalEarnings;
          }
        });
        if (companyPayout > 0) {
          weeklyPayouts.set(sa.id, (weeklyPayouts.get(sa.id) || 0) + companyPayout);
        }
      });
      
      // Aggregate weekly payouts for individuals
       payroll.reportData.forEach(techReport => {
         const user = allUsers.find(u => u.id === techReport.id);
         if(user && user.role === 'employee' && !user.assignedTo) {
            weeklyPayouts.set(user.id, (weeklyPayouts.get(user.id) || 0) + techReport.totalEarnings);
         }
       });

       // Update YTD totals and weekly breakdowns
       weeklyPayouts.forEach((amount, entityId) => {
          const entity = ytdMap.get(entityId);
          if(entity) {
            entity.ytdPayout += amount;
            entity.weeklyBreakdown.push({ week: weekLabel, amount });
          }
       });
    });

    return Array.from(ytdMap.values()).filter(e => e.ytdPayout > 0).sort((a,b) => b.ytdPayout - a.ytdPayout);
  });
  
  filteredWeeklySummary = computed(() => {
    const term = this.filterTerm().toLowerCase();
    if (!term) return this.weeklySummary();
    return this.weeklySummary().filter(e => e.name.toLowerCase().includes(term));
  });

  filteredYtdSummary = computed(() => {
    const term = this.filterTerm().toLowerCase();
    if (!term) return this.ytdSummary();
    return this.ytdSummary().filter(e => e.name.toLowerCase().includes(term));
  });

  selectPayroll(event: Event) {
    this.selectedPayrollId.set((event.target as HTMLSelectElement).value);
  }

  getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }
}