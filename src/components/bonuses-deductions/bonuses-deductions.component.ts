import { Component, ChangeDetectionStrategy, inject, signal, WritableSignal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { MockDataService } from '../../services/mock-data.service';
import { User, Loan, RecurringAdjustment, Adjustment } from '../../models/payroll.model';

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
  private dataService = inject(MockDataService);
  private fb: FormBuilder;

  users = computed(() => this.dataService.users().filter(u => u.role === 'employee' || u.role === 'sub-admin'));
  loans = this.dataService.loans;
  recurringAdjustments = this.dataService.recurringAdjustments;
  
  activeTab = signal<AdjustmentTab>('oneTime');
  showModal = signal<ModalType>(null);
  
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

  saveOneTime() {
    if (this.oneTimeForm.invalid) return;
    const { techId, type, description, amount, date } = this.oneTimeForm.value;
    const finalAmount = type === 'Bonus' ? Math.abs(parseFloat(amount)) : -Math.abs(parseFloat(amount));
    
    const newAdjustment: Omit<Adjustment, 'id'> = {
      techId,
      date,
      type,
      description,
      amount: finalAmount,
    };

    this.dataService.addOneTimeAdjustment(newAdjustment);
    this.closeModal();
  }

  saveLoan() {
    if (this.loanForm.invalid) return;
    const { techId, description, totalAmount, weeklyDeduction } = this.loanForm.value;
    if (parseFloat(weeklyDeduction) > parseFloat(totalAmount)) {
      alert('Weekly deduction cannot be greater than the total loan amount.');
      return;
    }
    const newLoan: Omit<Loan, 'id'> = {
      techId,
      description,
      totalAmount: parseFloat(totalAmount),
      remainingAmount: parseFloat(totalAmount),
      weeklyDeduction: parseFloat(weeklyDeduction),
      isActive: true,
    };
    this.dataService.addLoan(newLoan);
    this.closeModal();
  }

  saveRecurring() {
    if (this.recurringForm.invalid) return;
    const { techId, description, weeklyAmount } = this.recurringForm.value;
    const newRecurring: Omit<RecurringAdjustment, 'id'> = {
      techId,
      description,
      weeklyAmount: -Math.abs(parseFloat(weeklyAmount)), // ensure it's a deduction
      isActive: true,
    };
    this.dataService.addRecurringAdjustment(newRecurring);
    this.closeModal();
  }
  
  toggleLoanStatus(loan: Loan) {
    this.dataService.updateLoan({ ...loan, isActive: !loan.isActive });
  }
  
  toggleRecurringStatus(adj: RecurringAdjustment) {
    this.dataService.updateRecurringAdjustment({ ...adj, isActive: !adj.isActive });
  }

  getTechName(techId: string): string {
    return this.users().find(u => u.techId === techId)?.name || 'N/A';
  }
}