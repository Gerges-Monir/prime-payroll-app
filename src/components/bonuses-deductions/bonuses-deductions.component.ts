import { Component, ChangeDetectionStrategy, inject, signal, WritableSignal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { User, Loan, RecurringAdjustment, Adjustment } from '../../models/payroll.model';
import { NotificationService } from '../../services/notification.service';

type AdjustmentTab = 'oneTime' | 'loans' | 'recurring';
type ModalType = 'oneTime' | 'loan' | 'recurring' | null;

@Component({
  selector: 'app-bonuses-deductions',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './bonuses-deductions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BonusesDeductionsComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;

  users = computed(() => this.dataService.users().filter(u => u.role === 'employee' || u.role === 'sub-admin'));
  loans = this.dataService.loans;
  recurringAdjustments = this.dataService.recurringAdjustments;
  unprocessedAdjustments = this.dataService.adjustments;
  
  activeTab = signal<AdjustmentTab>('oneTime');
  showModal = signal<ModalType>(null);
  isSaving = signal(false);
  
  oneTimeForm: FormGroup;
  loanForm: FormGroup;
  recurringForm: FormGroup;

  constructor() {
    this.fb = inject(FormBuilder);
    
    this.oneTimeForm = this.fb.group({
      techId: ['', Validators.required],
      date: [new Date().toISOString().split('T')[0], Validators.required],
      type: ['Bonus', Validators.required],
      description: ['', Validators.required],
      amount: ['', [Validators.required, Validators.pattern(/^-?\d+(\.\d{1,2})?$/)]],
    });

    this.loanForm = this.fb.group({
      techId: ['', Validators.required],
      description: ['', Validators.required],
      totalAmount: ['', [Validators.required, Validators.min(0.01)]],
      weeklyDeduction: ['', [Validators.required, Validators.min(0.01)]],
    });

    this.recurringForm = this.fb.group({
      techId: ['', Validators.required],
      description: ['Equipment Rental', Validators.required],
      weeklyAmount: ['', [Validators.required, Validators.min(0.01)]],
    });
  }

  selectTab(tab: AdjustmentTab) {
    this.activeTab.set(tab);
  }

  openModal(type: ModalType) {
    if (type === 'oneTime') this.oneTimeForm.reset({ type: 'Bonus', date: new Date().toISOString().split('T')[0] });
    if (type === 'loan') this.loanForm.reset();
    if (type === 'recurring') this.recurringForm.reset({ description: 'Equipment Rental' });
    this.showModal.set(type);
  }

  closeModal() {
    this.showModal.set(null);
  }

  async saveOneTime() {
    if (this.oneTimeForm.invalid) return;
    this.isSaving.set(true);
    const { techId, type, description, amount, date } = this.oneTimeForm.value;
    const finalAmount = type === 'Bonus' ? Math.abs(parseFloat(amount)) : -Math.abs(parseFloat(amount));
    
    try {
      await this.dataService.addOneTimeAdjustment({ techId, date, type, description, amount: finalAmount });
      this.notificationService.showSuccess(`Adjustment added for ${this.getTechName(techId)}.`);
      this.closeModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.notificationService.showError(msg);
    } finally {
      this.isSaving.set(false);
    }
  }

  async deleteOneTimeAdjustment(adjustmentId: number): Promise<void> {
    if (confirm('Are you sure you want to delete this adjustment?')) {
      await this.dataService.deleteAdjustment(adjustmentId);
      this.notificationService.showSuccess('Adjustment deleted.');
    }
  }

  async saveLoan() {
    if (this.loanForm.invalid) return;
    this.isSaving.set(true);
    const { techId, description, totalAmount, weeklyDeduction } = this.loanForm.value;
    if (parseFloat(weeklyDeduction) > parseFloat(totalAmount)) {
      this.notificationService.showError('Weekly deduction cannot be greater than the total loan amount.');
      this.isSaving.set(false);
      return;
    }
    
    try {
      await this.dataService.addLoan({
        techId, description,
        totalAmount: parseFloat(totalAmount),
        remainingAmount: parseFloat(totalAmount),
        weeklyDeduction: parseFloat(weeklyDeduction),
        isActive: true,
      });
      this.notificationService.showSuccess(`Loan added for ${this.getTechName(techId)}.`);
      this.closeModal();
    } catch (e) {
       const msg = e instanceof Error ? e.message : String(e);
       this.notificationService.showError(msg);
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveRecurring() {
    if (this.recurringForm.invalid) return;
    this.isSaving.set(true);
    const { techId, description, weeklyAmount } = this.recurringForm.value;
    
    try {
      await this.dataService.addRecurringAdjustment({
        techId, description,
        weeklyAmount: -Math.abs(parseFloat(weeklyAmount)),
        isActive: true,
      });
      this.notificationService.showSuccess(`Recurring deduction added for ${this.getTechName(techId)}.`);
      this.closeModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.notificationService.showError(msg);
    } finally {
      this.isSaving.set(false);
    }
  }
  
  async toggleLoanStatus(loan: Loan) {
    await this.dataService.updateLoan({ ...loan, isActive: !loan.isActive });
    this.notificationService.showSuccess(`Loan for ${this.getTechName(loan.techId)} is now ${!loan.isActive ? 'Active' : 'Paused'}.`);
  }
  
  async toggleRecurringStatus(adj: RecurringAdjustment) {
    await this.dataService.updateRecurringAdjustment({ ...adj, isActive: !adj.isActive });
    this.notificationService.showSuccess(`Deduction for ${this.getTechName(adj.techId)} is now ${!adj.isActive ? 'Active' : 'Paused'}.`);
  }

  getTechName(techId: string): string {
    return this.users().find(u => u.techId === techId)?.name || 'N/A';
  }
}