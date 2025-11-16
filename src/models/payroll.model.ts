export interface User {
  id: number;
  name: string;
  username: string;
  password?: string; // Made optional for existing users, but required for new
  techId: string;
  email: string;
  phone: string;
  hireDate: string;
  role: 'employee' | 'sub-admin' | 'admin';
  assignedTo?: number; // sub-admin's user ID
  rateCategoryId?: number;
}

export interface Job {
    id: number;
    techId: string;
    taskCode: string;
    revenue: number;
    quantity: number;
    date: string; // YYYY-MM-DD
}

export interface StatCard {
  label: string;
  value: string;
  icon: string;
  color: string;
  description: string;
}

export type AdjustmentType = 'Bonus' | 'Chargeback' | 'Loan Payment' | 'Equipment Rental';

export interface Adjustment {
  id: number;
  techId: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // positive for bonus, negative for deduction
  type: AdjustmentType;
}

// NEW: Represents a job that has been processed and saved in a payroll.
// This is a snapshot and is immutable.
export interface ProcessedJob {
    id: number;
    taskCode: string;
    revenue: number;
    quantity: number;
    date: string; // YYYY-MM-DD
    rateApplied: number;
    earning: number;
}

export interface ProcessedTechnician {
    id: number;
    name: string;
    techId: string;
    totalJobs: number;
    totalEarnings: number; 
    totalRevenue: number;
    companyRevenue: number;
    avgPerJob: number;
    adjustments: Adjustment[];
    unprocessedAdjustments?: Adjustment[]; // For sub-admin current view
    processedJobs: ProcessedJob[]; // CHANGED: from jobs: Job[]
}

export interface Rate {
  taskCode: string;
  rate: number;
}

export interface RateCategory {
    id: number;
    name: string;
    rates: Rate[];
}

export interface PublishedPayroll {
  id: string; // e.g., '2024-07-21_2024-07-27'
  startDate: string;
  endDate: string;
  publishedDate: string;
  reportData: ProcessedTechnician[];
  status: 'draft' | 'finalized';
}

// NEW MODELS
export interface Loan {
  id: number;
  techId: string;
  description: string;
  totalAmount: number;
  remainingAmount: number;
  weeklyDeduction: number;
  isActive: boolean;
}

export interface RecurringAdjustment {
  id: number;
  techId: string;
  description: string;
  weeklyAmount: number; // always negative
  isActive: boolean;
}

// This will be stored for employees to view.
export interface EmployeePayrollReport {
  id: string; // Composite key: `${payrollId}_${userId}`
  userId: number;
  payrollId: string; // The ID from PublishedPayroll
  startDate: string;
  endDate: string;
  publishedDate: string;
  reportData: ProcessedTechnician; // The data for this specific employee
  status: 'draft' | 'finalized';
}

export type NotificationType = 'success' | 'error' | 'info';

export interface Notification {
  id: number;
  message: string;
  type: NotificationType;
}