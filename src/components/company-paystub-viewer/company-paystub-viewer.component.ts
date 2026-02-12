import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { AuthService } from '../../services/auth.service';
import { User, SubAdminPayrollBatch, RateCategory, Job } from '../../models/payroll.model';

@Component({
  selector: 'app-company-paystub-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './company-paystub-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyPaystubViewerComponent {
  private dataService = inject(DatabaseService);
  private authService = inject(AuthService);
  
  currentUser = this.authService.currentUser;
  
  finalizedBatches = computed(() => {
    const subAdminId = this.currentUser()?.id;
    if (!subAdminId) return [];
    return this.dataService.subAdminBatches()
      .filter(b => b.subAdminId === subAdminId && b.status === 'finalized')
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
  });

  selectedBatchId = signal<string | null>(null);

  selectedBatch = computed(() => {
    const id = this.selectedBatchId();
    if (!id) return this.finalizedBatches()[0] ?? null;
    return this.finalizedBatches().find(b => b.id === id) ?? null;
  });

  subAdminRateCategory = computed(() => {
    const subAdmin = this.currentUser();
    if (!subAdmin?.rateCategoryId) return null;
    return this.dataService.rateCategories().find(rc => rc.id === subAdmin.rateCategoryId) ?? null;
  });

  jobsWithSubAdminRevenue = computed(() => {
      const batch = this.selectedBatch();
      const rateCategory = this.subAdminRateCategory();
      if (!batch || !rateCategory) return batch?.jobs || [];

      const companyRates = new Map<string, number>(rateCategory.rates.map(r => [r.taskCode, r.rate]));

      return (batch.jobs || []).map(job => {
          const companyRateForJob = companyRates.get(job.taskCode) ?? 0;
          const subAdminRevenue = companyRateForJob * job.quantity;
          return { ...job, revenue: subAdminRevenue };
      });
  });

  reportData = computed(() => {
    const batch = this.selectedBatch();
    const subAdmin = this.currentUser();
    if (!batch || !subAdmin) return null;
    
    const jobsForProcessing = this.jobsWithSubAdminRevenue();
    const processedReport = this.dataService.processPayrollForJobs(jobsForProcessing, this.dataService.parseDateAsUTC(batch.startDate), this.dataService.parseDateAsUTC(batch.endDate));
    
    const subAdminReport = processedReport.find(r => r.id === subAdmin.id);
    const teamReports = processedReport.filter(r => r.id !== subAdmin.id);

    const totalJobs = jobsForProcessing.length;
    const totalRevenue = jobsForProcessing.reduce((sum, r) => sum + r.revenue, 0);
    const teamMemberPayout = teamReports.reduce((sum, r) => sum + r.totalEarnings, 0);
    const subAdminBaseEarnings = subAdminReport?.processedJobs.reduce((sum, j) => sum + j.earning, 0) ?? 0;
    const subAdminAdjustments = (subAdminReport?.totalEarnings ?? 0) - subAdminBaseEarnings;
    const totalPayout = processedReport.reduce((sum, r) => sum + r.totalEarnings, 0);

    return {
      totalJobs,
      totalRevenue,
      teamMemberPayout,
      subAdminBaseEarnings,
      subAdminAdjustments,
      totalPayout,
      teamReports: teamReports.sort((a, b) => a.name.localeCompare(b.name)),
      subAdminReport,
    };
  });
  
  ytdData = computed(() => {
    const allBatches = this.finalizedBatches();
    const subAdmin = this.currentUser();
    const rateCategory = this.subAdminRateCategory();
    if (allBatches.length === 0 || !subAdmin || !rateCategory) {
      return { ytdRevenue: 0, ytdPayout: 0, ytdCompanyProfit: 0 };
    }
    
    const companyRates = new Map<string, number>(rateCategory.rates.map(r => [r.taskCode, r.rate]));

    let ytdRevenue = 0;
    let ytdPayout = 0;
    let ytdCompanyProfit = 0;

    for (const batch of allBatches) {
      const jobsWithSubAdminRevenue = (batch.jobs || []).map(job => {
          const companyRateForJob = companyRates.get(job.taskCode) ?? 0;
          const subAdminRevenue = companyRateForJob * job.quantity;
          return { ...job, revenue: subAdminRevenue };
      });

      const report = this.dataService.processPayrollForJobs(jobsWithSubAdminRevenue, this.dataService.parseDateAsUTC(batch.startDate), this.dataService.parseDateAsUTC(batch.endDate));
      
      const batchRevenue = report.reduce((sum, r) => sum + r.totalRevenue, 0);
      const batchPayout = report.reduce((sum, r) => sum + r.totalEarnings, 0);
      
      ytdRevenue += batchRevenue;
      ytdPayout += batchPayout;

      const subAdminReport = report.find(r => r.id === subAdmin.id);
      const teamReports = report.filter(r => r.id !== subAdmin.id);
      const subAdminBaseEarnings = subAdminReport?.processedJobs.reduce((sum, j) => sum + j.earning, 0) ?? 0;
      const teamMemberPayout = teamReports.reduce((sum, r) => sum + r.totalEarnings, 0);
      const totalLaborCost = subAdminBaseEarnings + teamMemberPayout;
      
      ytdCompanyProfit += batchRevenue - totalLaborCost;
    }
    return { ytdRevenue, ytdPayout, ytdCompanyProfit };
  });

  selectBatch(event: Event) {
    this.selectedBatchId.set((event.target as HTMLSelectElement).value);
  }
}