import { Component, ChangeDetectionStrategy, inject, signal, WritableSignal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { User, Loan, RecurringAdjustment, Adjustment } from '../../models/payroll.model';
import { NotificationService } from '../../services/notification.service';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

type AdjustmentTab = 'oneTime' | 'loans' | 'recurring';
type ModalType = 'oneTime' | 'loan' | 'recurring' | 'editLoan' | 'editRecurring' | null;

@Component({
  selector: 'app-bonuses-deductions',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ConfirmationModalComponent, DatePipe, CurrencyPipe],
  templateUrl: './bonuses-deductions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BonusesDeductionsComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;
  private currencyPipe: CurrencyPipe;

  users = computed(() => this.dataService.users().filter(u => u.role === 'employee' || u.role === 'sub-admin' || u.role === 'supervisor'));
  loans = this.dataService.loans;
  recurringAdjustments = this.dataService.recurringAdjustments;
  unprocessedAdjustments = this.dataService.adjustments;
  
  activeTab = signal<AdjustmentTab>('oneTime');
  showModal = signal<ModalType>(null);
  isSaving = signal(false);
  loanToEdit = signal<Loan | null>(null);
  recurringToEdit = signal<RecurringAdjustment | null>(null);

  // Signals for delete confirmation
  showDeleteAdjustmentConfirm = signal(false);
  adjustmentToDelete = signal<Adjustment | null>(null);
  
  deleteMessage = computed(() => {
    const adj = this.adjustmentToDelete();
    if (!adj) return '';
    const techName = this.getTechName(adj.techId);
    const amount = this.currencyPipe.transform(adj.amount);
    return `Are you sure you want to delete this ${adj.type} of ${amount} for ${techName}?`;
  });

  oneTimeForm: FormGroup;
  loanForm: FormGroup;
  editLoanForm: FormGroup;
  recurringForm: FormGroup;
  editRecurringForm: FormGroup;
  
  loansByTechnician = computed(() => {
    const loans = this.loans();
    const userMap = new Map<string, User>(this.users().map(u => [u.techId, u]));

    const grouped = new Map<string, { user: User, loans: Loan[] }>();

    for (const loan of loans) {
        const user = userMap.get(loan.techId);
        if (user) {
            const entry = grouped.get(loan.techId);
            if (entry) {
                entry.loans.push(loan);
            } else {
                grouped.set(loan.techId, { user, loans: [loan] });
            }
        }
    }
    
    // Sort loans within each group by date
    grouped.forEach(value => {
        value.loans.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    });

    // Sort technicians by name
    return Array.from(grouped.values()).sort((a, b) => a.user.name.localeCompare(b.user.name));
  });
  
  userLoans = computed(() => {
    const selectedTechId = this.oneTimeForm.get('techId')?.value;
    if (!selectedTechId) {
      return [];
    }
    return this.loans().filter(l => l.techId === selectedTechId && l.isActive);
  });


  constructor() {
    this.fb = inject(FormBuilder);
    this.currencyPipe = inject(CurrencyPipe);
    
    this.oneTimeForm = this.fb.group({
      techId: ['', Validators.required],
      date: [new Date().toISOString().split('T')[0], Validators.required],
      type: ['Bonus', Validators.required],
      description: ['', Validators.required],
      amount: ['', [Validators.required, Validators.pattern(/^-?\d+(\.\d{1,2})?$/)]],
      loanId: [null],
    });

    this.loanForm = this.fb.group({
      techId: ['', Validators.required],
      date: [new Date().toISOString().split('T')[0], Validators.required],
      description: ['', Validators.required],
      totalAmount: ['', [Validators.required, Validators.min(0.01)]],
      isTaxable: [false],
    });

    this.editLoanForm = this.fb.group({
      description: ['', Validators.required],
    });

    this.recurringForm = this.fb.group({
      techId: ['', Validators.required],
      description: ['', Validators.required],
      weeklyAmount: ['', [Validators.required, Validators.min(0.01)]],
    });

     this.editRecurringForm = this.fb.group({
      description: ['', Validators.required],
      weeklyAmount: ['', [Validators.required, Validators.min(0.01)]],
    });
  }

  selectTab(tab: AdjustmentTab) {
    this.activeTab.set(tab);
  }

  openModal(type: ModalType) {
    if (type === 'oneTime') this.oneTimeForm.reset({ type: 'Bonus', date: new Date().toISOString().split('T')[0], loanId: null });
    if (type === 'loan') this.loanForm.reset({ date: new Date().toISOString().split('T')[0], isTaxable: false });
    if (type === 'recurring') this.recurringForm.reset({ description: 'Rent' });
    this.loanToEdit.set(null);
    this.recurringToEdit.set(null);
    this.showModal.set(type);
  }

  openEditLoanModal(loan: Loan) {
    this.loanToEdit.set(loan);
    this.editLoanForm.patchValue({
        description: loan.description,
    });
    this.showModal.set('editLoan');
  }
  
  openEditRecurringModal(adj: RecurringAdjustment) {
    this.recurringToEdit.set(adj);
    this.editRecurringForm.patchValue({
      description: adj.description,
      weeklyAmount: Math.abs(adj.weeklyAmount),
    });
    this.showModal.set('editRecurring');
  }

  closeModal() {
    this.showModal.set(null);
    this.loanToEdit.set(null);
    this.recurringToEdit.set(null);
  }

  async saveOneTime() {
    if (this.oneTimeForm.invalid) return;
    this.isSaving.set(true);
    const { techId, type, description, amount, date, loanId } = this.oneTimeForm.value;

    if (type === 'Loan Payment' && !loanId) {
      this.notificationService.showError('Please select a loan to apply the payment to.');
      this.isSaving.set(false);
      return;
    }

    const finalAmount = type === 'Bonus' ? Math.abs(parseFloat(amount)) : -Math.abs(parseFloat(amount));
    
    try {
      const adjustment: Omit<Adjustment, 'id'> = { techId, date, type, description, amount: finalAmount };
      if (type === 'Loan Payment') {
        adjustment.loanId = loanId;
      }

      await this.dataService.addOneTimeAdjustment(adjustment);
      this.notificationService.showSuccess(`Adjustment added for ${this.getTechName(techId)}.`);
      this.closeModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.notificationService.showError(msg);
    } finally {
      this.isSaving.set(false);
    }
  }

  deleteOneTimeAdjustment(adjustment: Adjustment): void {
    console.log(`[Adjustments] 1. Delete button clicked for adjustment ID: ${adjustment.id}`);
    console.log(`[Adjustments] 2. Adjustment to delete:`, JSON.parse(JSON.stringify(adjustment)));
    this.adjustmentToDelete.set(adjustment);
    this.showDeleteAdjustmentConfirm.set(true);
  }
  
  async handleAdjustmentDelete(confirmed: boolean): Promise<void> {
    const adj = this.adjustmentToDelete();
    this.showDeleteAdjustmentConfirm.set(false);

    if (confirmed && adj) {
      console.log(`[Adjustments] 3. User confirmed deletion for adjustment ID ${adj.id}.`);
      try {
        await this.dataService.deleteAdjustment(adj.id);
        this.notificationService.showSuccess('Adjustment deleted.');
        console.log(`[Adjustments] 4. ✅ Successfully called dataService.deleteAdjustment for ID: ${adj.id}`);
      } catch (error) {
        console.error(`[Adjustments] 5. ❌ Error deleting adjustment ID ${adj.id}:`, error);
        this.notificationService.showError(error instanceof Error ? error.message : 'Failed to delete adjustment.');
      }
    } else {
        console.log(`[Adjustments] 3. Deletion cancelled for adjustment ID: ${adj?.id}`);
    }
    this.adjustmentToDelete.set(null);
  }

  async saveLoan() {
    if (this.loanForm.invalid) return;
    this.isSaving.set(true);
    const { techId, description, totalAmount, date, isTaxable } = this.loanForm.value;
    
    try {
      await this.dataService.addLoan({
        techId, description, date, isTaxable,
        totalAmount: parseFloat(totalAmount),
        remainingAmount: parseFloat(totalAmount),
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

  async updateLoan() {
    if (this.editLoanForm.invalid) return;
    this.isSaving.set(true);
    const originalLoan = this.loanToEdit();
    if (!originalLoan) {
      this.isSaving.set(false);
      return;
    }

    const formValue = this.editLoanForm.value;

    try {
      const updatedLoan: Loan = {
        ...originalLoan,
        description: formValue.description,
      };
      await this.dataService.updateLoan(updatedLoan);
      this.notificationService.showSuccess(`Loan updated for ${this.getTechName(updatedLoan.techId)}.`);
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

  async updateRecurring() {
    if (this.editRecurringForm.invalid) return;
    this.isSaving.set(true);
    const originalAdj = this.recurringToEdit();
    if (!originalAdj) {
      this.isSaving.set(false);
      return;
    }

    const formValue = this.editRecurringForm.value;
    const updatedAdj: RecurringAdjustment = {
      ...originalAdj,
      description: formValue.description,
      weeklyAmount: -Math.abs(parseFloat(formValue.weeklyAmount)),
    };

    try {
      await this.dataService.updateRecurringAdjustment(updatedAdj);
      this.notificationService.showSuccess(`Recurring deduction for ${this.getTechName(updatedAdj.techId)} updated.`);
      this.closeModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.notificationService.showError(msg);
    } finally {
      this.isSaving.set(false);
    }
  }
  
  async toggleRecurringStatus(adj: RecurringAdjustment) {
    await this.dataService.updateRecurringAdjustment({ ...adj, isActive: !adj.isActive });
    this.notificationService.showSuccess(`Deduction for ${this.getTechName(adj.techId)} is now ${adj.isActive ? 'Paused' : 'Active'}.`);
  }

  getTechName(techId: string): string {
    return this.users().find(u => u.techId === techId)?.name || 'N/A';
  }
}