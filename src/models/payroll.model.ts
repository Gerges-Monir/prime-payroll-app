export interface User {
  id: string;
  uid?: string; // Firebase Auth User ID for robust linking
  name: string;
  username: string;
  password?: string; // Made optional for existing users, but required for new
  techId: string;
  email: string;
  phone: string;
  hireDate: string;
  role: 'employee' | 'sub-admin' | 'admin' | 'supervisor';
  assignedTo?: string; // sub-admin's user ID
  // FIX: Rate category ID should be a string to match Firestore document ID.
  rateCategoryId?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  tin?: string; // Taxpayer Identification Number (SSN or EIN)
  companyName?: string; // For sub-admins operating as a company
  profitShare?: number; // Profit share percentage for sub-admins
  payoutOverrides?: { taskCode: string; rate: number }[]; // For sub-admins to set payouts for their team
}

export interface Job {
    id: string;
    workOrder: string;
    techId: string;
    taskCode: string;
    revenue: number;
    quantity: number;
    date: string; // YYYY-MM-DD
    rateOverride?: number;
    isAerialDrop?: boolean;
}

export interface StatCard {
  label: string;
  value: string;
  icon: string;
  color: string;
  description: string;
}

export type AdjustmentType = 'Bonus' | 'Chargeback' | 'Loan' | 'Rent' | 'Fee' | 'RepeatTC' | 'Loan Payment' | 'Profit Share';

export interface Adjustment {
  id: string;
  techId: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // positive for bonus, negative for deduction
  type: AdjustmentType;
  loanId?: string; // To link a payment to a specific loan
}

// NEW: Represents a job that has been processed and saved in a payroll.
// This is a snapshot and is immutable.
export interface ProcessedJob {
    id: string;
    workOrder: string;
    techId: string; // Added to correctly revert jobs
    taskCode: string;
    revenue: number;
    quantity: number;
    date: string; // YYYY-MM-DD
    rateApplied: number;
    earning: number;
    rateOverride?: number; // Added to correctly revert jobs
    isAerialDrop?: boolean;
}

export interface ProcessedTechnician {
    id: string;
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
  id: string;
  name: string;
  rates: Rate[];
}

export interface PublishedPayroll {
    id: string; // e.g., '2023-01-01_2023-01-07'
    startDate: string;
    endDate: string;
    publishedDate: string;
    reportData: ProcessedTechnician[];
    status: 'finalized';
}

export interface Loan {
  id: string;
  techId: string;
  description: string;
  totalAmount: number;
  remainingAmount: number;
  isActive: boolean;
  date: string; // YYYY-MM-DD
  isTaxable: boolean;
}

export interface RecurringAdjustment {
  id: string;
  techId: string;
  description: string;
  weeklyAmount: number; // Always negative
  isActive: boolean;
}

export interface EmployeePayrollReport {
  id: string;
  userId: string;
  payrollId: string;
  paymentId: number; // The week number of the year for this payment
  startDate: string;
  endDate: string;
  publishedDate: string;
  reportData: ProcessedTechnician;
  status: 'finalized';
}

export interface PerformanceReport {
  id: string; // weekStartDate_userId
  userId: string;
  weekStartDate: string;
  imageDataUrl: string; // base64 encoded image
  notes: string;
  status: 'draft' | 'published';
}

export interface PerformanceDataset {
  id: string;
  fileName: string;
  uploadDate: string; // ISO string
  dataUrl: string; // base64 encoded .xlsx file
}

export interface SubAdminPayrollBatch {
    id: string;
    subAdminId: string;
    startDate: string;
    endDate: string;
    jobs: Job[];
    status: 'pending' | 'finalized';
}

export interface ChargebackSummaryItem {
  company: string;
  chargeback: string;
  amount: number;
}

export interface ChargebackReport {
  id: string; // monthIdentifier_userId
  userId: string;
  monthIdentifier: string; // YYYY-MM
  uploadDate: string;
  fileName: string;
  fileDataUrl: string; // base64 encoded .xlsx file
  summaryData: ChargebackSummaryItem[];
  totalCharge: number;
  status: 'draft' | 'published';
}

export interface SubAdminSettings {
  id?: string;
  subAdminId: string;
  logoUrl?: string;
  companyName?: string;
  companyAddress1?: string;
  companyAddress2?: string;
  companyEmail?: string;
  companyPhone?: string;
}

export interface CareerApplication {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  hasDriversLicense: boolean;
  willingToTravel: boolean;
  isFluentInEnglish: boolean;
  resumeLink?: string;
  resume?: {
    fileName: string;
    fileType: string;
    dataUrl: string; // base64
  };
  customAnswers?: { question: string; answer: string }[];
  submissionDate: string;
}

export interface JobOpening {
  id: string;
  title: string;
  description: string;
  requirements: string; // Newline-separated
  isActive: boolean;
  datePosted: string;
  customQuestions?: string[];
}

export interface QcFormTemplate {
  id: string;
  name: string;
  sections: string[];
  isActive: boolean;
  dateCreated: string;
}

export interface QcImageUpload {
  section: string;
  fileName: string;
  fileType: string;
  dataUrl: string; // base64
}

export interface QcSubmission {
  id: string;
  userId: string;
  techId: string;
  formTemplateId: string;
  formTemplateName: string;
  submissionDate: string; // YYYY-MM-DD
  accountNumber?: string;
  uploads: QcImageUpload[];
  dateCreated: string; // ISO string
}

export interface Notification {
  id: number;
  message: string;
  type: NotificationType;
}

export type NotificationType = 'success' | 'error' | 'info';