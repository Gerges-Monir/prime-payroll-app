import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { User } from '../../models/payroll.model';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-revenue-analysis',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule],
  templateUrl: './supervisors.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RevenueAnalysisComponent {
  private dataService = inject(DatabaseService);

  // State
  selectedWeekId = signal<string>('all');
  selectedTechId = signal<string>('all');

  // Data sources
  payrolls = computed(() => 
    this.dataService.publishedPayrolls().sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())
  );
  technicians = computed(() => 
    this.dataService.users().filter(u => u.role === 'employee' || u.role === 'sub-admin' || u.role === 'supervisor').sort((a,b) => a.name.localeCompare(b.name))
  );
  
  // Filtering
  filteredPayrolls = computed(() => {
    const weekId = this.selectedWeekId();
    if (weekId === 'all') {
      return this.payrolls();
    }
    return this.payrolls().filter(p => p.id === weekId);
  });

  // Main computation
  analysisData = computed(() => {
    const payrolls = this.filteredPayrolls();
    const techIdFilter = this.selectedTechId();
    
    const techBreakdown = new Map<string, { id: string, name: string, techId: string, totalRevenueInCents: number, totalPayoutInCents: number }>();

    for (const payroll of payrolls) {
      for (const techReport of payroll.reportData) {
        let entry = techBreakdown.get(techReport.id);
        if (!entry) {
          entry = { id: techReport.id, name: techReport.name, techId: techReport.techId, totalRevenueInCents: 0, totalPayoutInCents: 0 };
          techBreakdown.set(techReport.id, entry);
        }
        entry.totalRevenueInCents += Math.round((techReport.totalRevenue || 0) * 100);
        entry.totalPayoutInCents += Math.round((techReport.totalEarnings || 0) * 100);
      }
    }
    
    let finalBreakdown = Array.from(techBreakdown.values()).map(tech => ({
      id: tech.id,
      name: tech.name,
      techId: tech.techId,
      totalRevenue: tech.totalRevenueInCents / 100,
      totalPayout: tech.totalPayoutInCents / 100,
      companyRevenue: (tech.totalRevenueInCents - tech.totalPayoutInCents) / 100,
    }));
    
    // Filter by technician if one is selected
    if (techIdFilter !== 'all') {
      finalBreakdown = finalBreakdown.filter(tech => tech.id === techIdFilter);
    }

    const totalGrossRevenueInCents = finalBreakdown.reduce((sum, tech) => sum + Math.round(tech.totalRevenue * 100), 0);
    const totalTechPayoutInCents = finalBreakdown.reduce((sum, tech) => sum + Math.round(tech.totalPayout * 100), 0);
    const totalCompanyRevenueInCents = totalGrossRevenueInCents - totalTechPayoutInCents;

    return {
      totalCompanyRevenue: totalCompanyRevenueInCents / 100,
      totalTechPayout: totalTechPayoutInCents / 100,
      totalGrossRevenue: totalGrossRevenueInCents / 100,
      techBreakdown: finalBreakdown.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}