import { Injectable, signal, computed, effect } from '@angular/core';
import { User, StatCard, ProcessedTechnician, Job, RateCategory, Rate, PublishedPayroll, Adjustment, Loan, RecurringAdjustment, EmployeePayrollReport, ProcessedJob } from '../models/payroll.model';

// Defines the entire shape of our client-side database.
interface AppState {
  users: User[];
  jobs: Job[];
  rateCategories: RateCategory[];
  adjustments: Adjustment[];
  publishedPayrolls: PublishedPayroll[];
  loans: Loan[];
  recurringAdjustments: RecurringAdjustment[];
  employeeReports: EmployeePayrollReport[];
}

const DB_KEY = 'primePayroll_database_v3'; // Incremented version to avoid old data conflicts

@Injectable({
  providedIn: 'root',
})
export class DatabaseService {
  // A single signal to hold the entire application state.
  private state = signal<AppState>(this.getInitialState());

  // Public computed signals expose slices of the state reactively and safely.
  users = computed(() => this.state().users);
  jobs = computed(() => this.state().jobs);
  rateCategories = computed(() => this.state().rateCategories);
  adjustments = computed(() => this.state().adjustments);
  publishedPayrolls = computed(() => this.state().publishedPayrolls);
  loans = computed(() => this.state().loans);
  recurringAdjustments = computed(() => this.state().recurringAdjustments);
  employeeReports = computed(() => this.state().employeeReports);
  
  stats = computed(() => this._calculateStats());
  processedTechnicians = computed(() => this.processPayrollForJobs(this.jobs(), new Date(0), new Date(0)));

  constructor() {
    // This effect automatically saves the entire state to localStorage whenever it changes.
    effect(() => {
      this._saveState(this.state());
    });
  }

  async initialize(): Promise<void> {
    // Simulate loading time for better UX on startup
    await new Promise(resolve => setTimeout(resolve, 500));
    const loadedState = this._loadState();
    this.state.set(loadedState);
  }

  private getInitialState(): AppState {
    return {
      users: [
        { id: 1, name: 'Admin User', username: 'admin', password: 'admin', techId: '001', email: 'admin@prime.com', phone: '555-0100', hireDate: '2020-01-01', role: 'admin' },
      ],
      jobs: [],
      rateCategories: [],
      adjustments: [],
      publishedPayrolls: [],
      loans: [],
      recurringAdjustments: [],
      employeeReports: [],
    };
  }

  private _loadState(): AppState {
    try {
      const storedState = localStorage.getItem(DB_KEY);
      if (storedState) {
        return JSON.parse(storedState);
      }
    } catch (e) {
      console.error('Failed to load state from localStorage, initializing with defaults.', e);
    }
    return this.getInitialState();
  }

  private _saveState(state: AppState): void {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Fatal Error: Could not save state to browser storage.', e);
      alert(`Failed to save changes. Your browser storage might be full or disabled (e.g., in private browsing mode).`);
    }
  }

  private async operation<T>(fn: (current: AppState) => { newState: AppState, result: T }): Promise<T> {
    return new Promise((resolve) => {
        const { newState, result } = fn(this.state());
        this.state.set(newState);
        resolve(result);
    });
  }

  // --- MUTATION METHODS ---
  async addUser(user: Omit<User, 'id' | 'hireDate'>): Promise<void> {
    return this.operation(current => {
      const existingUser = current.users.find(u => u.techId.toLowerCase() === user.techId.toLowerCase() || u.username.toLowerCase() === user.username.toLowerCase());
      if (existingUser) {
        throw new Error(`User with Tech ID '${user.techId}' or Username '${user.username}' already exists.`);
      }
      const newUser: User = {
        ...user,
        id: Math.max(...current.users.map(u => u.id), 0) + 1,
        hireDate: new Date().toISOString().split('T')[0],
      };
      return { newState: { ...current, users: [...current.users, newUser] }, result: undefined };
    });
  }

  async addPlaceholderUsers(techIds: string[]): Promise<void> {
    return this.operation(current => {
      const existingTechIds = new Set(current.users.map(u => u.techId));
      let maxId = Math.max(...current.users.map(u => u.id).filter(id => !isNaN(id)), 0);
      const firstCategoryId = current.rateCategories[0]?.id;
      const newUsers: User[] = [];

      for (const techId of techIds) {
        if (techId && !existingTechIds.has(techId)) {
          maxId++;
          newUsers.push({
            id: maxId, name: `User (Tech ID: ${techId})`, username: `user_${techId}`,
            password: techId, techId: techId, email: `user+${techId}@example.com`,
            phone: 'N/A', hireDate: new Date().toISOString().split('T')[0],
            role: 'employee', rateCategoryId: firstCategoryId,
          });
          existingTechIds.add(techId);
        }
      }
      const newState = newUsers.length > 0 ? { ...current, users: [...current.users, ...newUsers] } : current;
      return { newState, result: undefined };
    });
  }

  async updateUser(updatedUser: User): Promise<void> {
    return this.operation(current => {
      const existingUser = current.users.find(u => u.id !== updatedUser.id && (u.techId.toLowerCase() === updatedUser.techId.toLowerCase() || u.username.toLowerCase() === updatedUser.username.toLowerCase()));
      if (existingUser) {
        throw new Error(`Another user with Tech ID '${updatedUser.techId}' or Username '${updatedUser.username}' already exists.`);
      }
      const newState = { ...current, users: current.users.map(u => u.id === updatedUser.id ? updatedUser : u) };
      return { newState, result: undefined };
    });
  }

  async deleteUser(userId: number): Promise<void> {
    return this.operation(current => {
        const userToDelete = current.users.find(u => u.id === userId);
        if (!userToDelete) throw new Error(`User with ID: ${userId} not found.`);
        if (userToDelete.role === 'admin') throw new Error("The main administrator account cannot be deleted.");

        const techIdToDelete = userToDelete.techId;
        const newState = { ...current };
        
        newState.jobs = current.jobs.filter(j => j.techId !== techIdToDelete);
        newState.adjustments = current.adjustments.filter(a => a.techId !== techIdToDelete);
        newState.loans = current.loans.filter(l => l.techId !== techIdToDelete);
        newState.recurringAdjustments = current.recurringAdjustments.filter(adj => adj.techId !== techIdToDelete);

        let usersWithUnassignments = current.users;
        if (userToDelete.role === 'sub-admin') {
            usersWithUnassignments = usersWithUnassignments.map(user => user.assignedTo === userId ? { ...user, assignedTo: undefined } : user);
        }
        newState.users = usersWithUnassignments.filter(u => u.id !== userId);
        
        return { newState, result: undefined };
    });
  }

  async assignEmployeeToSubAdmin(employeeId: number, subAdminId: number): Promise<void> {
    return this.operation(current => ({
      newState: { ...current, users: current.users.map(u => u.id === employeeId ? { ...u, assignedTo: subAdminId } : u) },
      result: undefined
    }));
  }

  async unassignEmployee(employeeId: number): Promise<void> {
    return this.operation(current => ({
      newState: { ...current, users: current.users.map(u => u.id === employeeId ? { ...u, assignedTo: undefined } : u) },
      result: undefined
    }));
  }

  async addJobs(newJobs: Omit<Job, 'id'>[]): Promise<void> {
    return this.operation(current => {
      const maxId = Math.max(0, ...current.jobs.map(j => j.id));
      const jobsWithIds = newJobs.map((job, index) => ({ ...job, id: maxId + index + 1 }));
      return { newState: { ...current, jobs: [...current.jobs, ...jobsWithIds] }, result: undefined };
    });
  }

  async updateJob(updatedJob: Job): Promise<void> {
    return this.operation(current => ({
      newState: { ...current, jobs: current.jobs.map(j => j.id === updatedJob.id ? updatedJob : j) },
      result: undefined
    }));
  }

  async deleteJob(jobId: number): Promise<void> {
    return this.operation(current => ({
      newState: { ...current, jobs: current.jobs.filter(j => j.id !== jobId) },
      result: undefined
    }));
  }

  async clearJobs(): Promise<void> {
    return this.operation(current => ({
      newState: { ...current, jobs: [], adjustments: [] },
      result: undefined
    }));
  }

  async addRateCategory(name: string): Promise<void> {
    return this.operation(current => {
      const maxId = Math.max(0, ...current.rateCategories.map(rc => rc.id));
      const newCategory: RateCategory = { id: maxId + 1, name, rates: [] };
      return { newState: { ...current, rateCategories: [...current.rateCategories, newCategory] }, result: undefined };
    });
  }

  async updateRatesForCategory(categoryId: number, newRates: Rate[]): Promise<void> {
    return this.operation(current => ({
      newState: { ...current, rateCategories: current.rateCategories.map(cat => cat.id === categoryId ? { ...cat, rates: newRates } : cat) },
      result: undefined
    }));
  }

  async updateRateCategory(categoryId: number, newName: string): Promise<void> {
    return this.operation(current => {
      const existing = current.rateCategories.find(c => c.name.toLowerCase() === newName.toLowerCase() && c.id !== categoryId);
      if (existing) throw new Error(`A category named "${newName}" already exists.`);
      return { newState: { ...current, rateCategories: current.rateCategories.map(cat => cat.id === categoryId ? { ...cat, name: newName } : cat) }, result: undefined };
    });
  }

  async deleteRateCategory(categoryId: number): Promise<void> {
    return this.operation(current => {
        const updatedUsers = current.users.map(user => user.rateCategoryId === categoryId ? { ...user, rateCategoryId: undefined } : user);
        const updatedRateCategories = current.rateCategories.filter(cat => cat.id !== categoryId);
        return { newState: { ...current, users: updatedUsers, rateCategories: updatedRateCategories }, result: undefined };
    });
  }

  async addOneTimeAdjustment(adjustment: Omit<Adjustment, 'id'>): Promise<void> {
    return this.operation(current => {
      const newAdjustment: Adjustment = { ...adjustment, id: Date.now() + Math.random() };
      return { newState: { ...current, adjustments: [...current.adjustments, newAdjustment] }, result: undefined };
    });
  }
  
  async deleteAdjustment(adjustmentId: number): Promise<void> {
    return this.operation(current => ({
      newState: { ...current, adjustments: current.adjustments.filter(a => a.id !== adjustmentId) },
      result: undefined
    }));
  }

  async addLoan(loan: Omit<Loan, 'id'>): Promise<void> {
    return this.operation(current => {
      const newLoan: Loan = { ...loan, id: Date.now() };
      return { newState: { ...current, loans: [...current.loans, newLoan] }, result: undefined };
    });
  }

  async updateLoan(updatedLoan: Loan): Promise<void> {
    return this.operation(current => ({
      newState: { ...current, loans: current.loans.map(l => l.id === updatedLoan.id ? updatedLoan : l) },
      result: undefined
    }));
  }

  async addRecurringAdjustment(adjustment: Omit<RecurringAdjustment, 'id'>): Promise<void> {
    return this.operation(current => {
      const newAdjustment: RecurringAdjustment = { ...adjustment, id: Date.now() };
      return { newState: { ...current, recurringAdjustments: [...current.recurringAdjustments, newAdjustment] }, result: undefined };
    });
  }

  async updateRecurringAdjustment(updatedAdjustment: RecurringAdjustment): Promise<void> {
    return this.operation(current => ({
      newState: { ...current, recurringAdjustments: current.recurringAdjustments.map(a => a.id === updatedAdjustment.id ? updatedAdjustment : a) },
      result: undefined
    }));
  }
  
  async publishPayroll(reportToPublish: ProcessedTechnician[], jobsInReport: Job[], startDate: string, endDate: string): Promise<string> {
    const newPayrollId = `${startDate}_${endDate}_${Date.now()}`;
    
    return this.operation(current => {
        if (jobsInReport.length === 0 && reportToPublish.every(r => r.adjustments.length === 0)) {
            throw new Error("There are no jobs or adjustments to publish.");
        }

        const newPayroll: PublishedPayroll = {
            id: newPayrollId, startDate, endDate, status: 'draft',
            publishedDate: new Date().toISOString().split('T')[0],
            reportData: reportToPublish,
        };

        const updatedLoans = current.loans.map(loan => {
            const pmt = reportToPublish.find(r => r.techId === loan.techId)?.adjustments.find(a => a.type === 'Loan Payment' && a.description === loan.description);
            if (pmt) {
                const newRemaining = Number(loan.remainingAmount) + pmt.amount;
                return { ...loan, remainingAmount: newRemaining, isActive: newRemaining > 0 };
            }
            return loan;
        });

        const newEmployeeReports = reportToPublish.map(techReport => {
            const user = current.users.find(u => u.techId === techReport.techId);
            if (!user) return null;
            return {
                id: `${newPayrollId}_${user.id}`, userId: user.id, payrollId: newPayrollId,
                startDate, endDate, publishedDate: newPayroll.publishedDate,
                reportData: techReport, status: 'draft',
            } as EmployeePayrollReport;
        }).filter((r): r is EmployeePayrollReport => r !== null);
        
        const jobsToPublishIds = new Set(jobsInReport.map(j => j.id));
        const oneTimeAdjustmentIds = new Set<number>();
        reportToPublish.forEach(tech => tech.adjustments.forEach(adj => {
            if (adj.type === 'Bonus' || adj.type === 'Chargeback') oneTimeAdjustmentIds.add(adj.id);
        }));

        const newState = {
            ...current,
            loans: updatedLoans,
            employeeReports: [...current.employeeReports, ...newEmployeeReports],
            publishedPayrolls: [...current.publishedPayrolls, newPayroll].sort((a,b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
            jobs: current.jobs.filter(job => !jobsToPublishIds.has(job.id)),
            adjustments: current.adjustments.filter(a => !oneTimeAdjustmentIds.has(a.id))
        };
        return { newState, result: newPayrollId };
    });
  }

  async finalizePayroll(payrollId: string): Promise<void> {
    return this.operation(current => ({
      newState: {
        ...current,
        publishedPayrolls: current.publishedPayrolls.map(p => p.id === payrollId ? { ...p, status: 'finalized' } : p),
        employeeReports: current.employeeReports.map(r => r.payrollId === payrollId ? { ...r, status: 'finalized' } : r)
      },
      result: undefined
    }));
  }

  async unfinalizePayroll(payrollId: string): Promise<void> {
    return this.operation(current => ({
      newState: {
        ...current,
        publishedPayrolls: current.publishedPayrolls.map(p => p.id === payrollId ? { ...p, status: 'draft' } : p),
        employeeReports: current.employeeReports.map(r => r.payrollId === payrollId ? { ...r, status: 'draft' } : r)
      },
      result: undefined
    }));
  }

  async deletePayroll(payrollId: string): Promise<void> {
    return this.operation(current => {
      const payrollToDelete = current.publishedPayrolls.find(p => p.id === payrollId);
      if (!payrollToDelete) return { newState: current, result: undefined };
      if (payrollToDelete.status === 'finalized') {
        throw new Error('Cannot delete a finalized payroll. Un-finalize it first.');
      }
      return {
        newState: {
            ...current,
            publishedPayrolls: current.publishedPayrolls.filter(p => p.id !== payrollId),
            employeeReports: current.employeeReports.filter(r => r.payrollId !== payrollId)
        },
        result: undefined
      };
    });
  }

  // --- READ/COMPUTATION METHODS ---
  private _calculateStats(): StatCard[] {
    const techs = this.processedTechnicians();
    const totalJobs = techs.reduce((sum, tech) => sum + tech.totalJobs, 0);
    const totalRevenue = techs.reduce((sum, tech) => sum + tech.totalRevenue, 0);
    const companyRevenue = techs.reduce((sum, tech) => sum + tech.companyRevenue, 0);
    const totalEmployees = this.users().filter(u => u.role !== 'admin').length;
    return [
        { label: 'Total Employees', value: totalEmployees.toString(), icon: '', color: 'blue', description: 'Active workforce' },
        { label: 'Monthly Revenue', value: `$${totalRevenue.toFixed(0)}`, icon: '', color: 'green', description: `From ${totalJobs} jobs` },
        { label: 'Company Revenue', value: `$${companyRevenue.toFixed(0)}`, icon: '', color: 'purple', description: 'Current unprocessed work' },
        { label: 'Monthly Jobs', value: totalJobs.toString(), icon: '', color: 'orange', description: 'Current unprocessed work' },
    ];
  }
  
  processPayrollForJobs(jobsToProcess: Job[], reportStartDate: Date, reportEndDate: Date): ProcessedTechnician[] {
    const { users, rateCategories, adjustments, loans, recurringAdjustments } = this.state();

    const techDataMap = new Map<string, {
      id: number; name: string; techId: string;
      totalJobs: number; totalRevenue: number; baseEarnings: number; 
      adjustments: Adjustment[]; processedJobs: ProcessedJob[];
    }>();

    users.forEach(user => {
        if (user.role === 'employee' || user.role === 'sub-admin') {
            techDataMap.set(user.techId, {
                id: user.id, name: user.name, techId: user.techId,
                totalJobs: 0, totalRevenue: 0, baseEarnings: 0, adjustments: [], processedJobs: [],
            });
        }
    });

    techDataMap.forEach(tech => {
        recurringAdjustments.filter(ra => ra.techId === tech.techId && ra.isActive)
            .forEach(ra => tech.adjustments.push({ id: Date.now() + Math.random(), techId: tech.techId, date: reportEndDate.toISOString().split('T')[0], type: 'Equipment Rental', description: ra.description, amount: ra.weeklyAmount }));

        loans.filter(l => l.techId === tech.techId && l.isActive && l.remainingAmount > 0)
            .forEach(l => {
                const paymentAmount = Math.min(l.remainingAmount, l.weeklyDeduction);
                tech.adjustments.push({ id: Date.now() + Math.random(), techId: tech.techId, date: reportEndDate.toISOString().split('T')[0], type: 'Loan Payment', description: l.description, amount: -paymentAmount });
            });
        
        const oneTimeAdjustmentsForPeriod = adjustments.filter(adj => {
            if (adj.techId !== tech.techId) return false;
            if (reportStartDate.getTime() === 0 && reportEndDate.getTime() === 0) return true;
            const adjDate = this.parseDateAsUTC(adj.date);
            return adjDate >= reportStartDate && adjDate <= reportEndDate;
        });
        tech.adjustments.push(...oneTimeAdjustmentsForPeriod);
    });

    jobsToProcess.forEach(job => {
        const tech = techDataMap.get(job.techId);
        if (!tech) return;

        const user = users.find(u => u.techId === job.techId);
        if (!user || user.rateCategoryId === undefined) return;

        const category = rateCategories.find(rc => rc.id === user.rateCategoryId);
        const rateMap = new Map(category?.rates.map(r => [r.taskCode.toLowerCase().trim(), r.rate]));
        const rateApplied = rateMap.get(job.taskCode.toLowerCase().trim()) ?? 0;
        const earning = rateApplied * job.quantity;
        
        tech.totalJobs += 1;
        tech.totalRevenue += job.revenue;
        tech.baseEarnings += earning;
        tech.processedJobs.push({ ...job, rateApplied, earning });
    });

    return Array.from(techDataMap.values()).map(tech => {
        const adjustmentTotal = tech.adjustments.reduce((sum: number, adj: Adjustment) => sum + adj.amount, 0);
        const finalTotalEarnings = tech.baseEarnings + adjustmentTotal;
        return {
            id: tech.id, name: tech.name, techId: tech.techId,
            totalJobs: tech.totalJobs, totalRevenue: tech.totalRevenue,
            totalEarnings: finalTotalEarnings, 
            companyRevenue: tech.totalRevenue - finalTotalEarnings,
            avgPerJob: tech.totalJobs > 0 ? tech.baseEarnings / tech.totalJobs : 0,
            adjustments: tech.adjustments,
            processedJobs: tech.processedJobs.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        };
    })
    .filter(tech => tech.totalJobs > 0 || tech.adjustments.length > 0);
  }

  parseDateAsUTC(dateString: string): Date {
    const parts = dateString.split('-').map(Number);
    return (parts.length === 3 && !parts.some(isNaN)) ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])) : new Date('invalid');
  }

  getStartOfWeek(date: Date): Date {
      const dt = this.parseDateAsUTC(date.toISOString().split('T')[0]);
      dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
      return dt;
  }
}