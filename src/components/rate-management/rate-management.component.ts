import { Component, ChangeDetectionStrategy, signal, inject, computed, effect, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { Rate, RateCategory } from '../../models/payroll.model';
import { NotificationService } from '../../services/notification.service';
import { ConfirmationModalComponent } from '../shared/confirmation-modal/confirmation-modal.component';

declare var XLSX: any;

@Component({
  selector: 'app-rate-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ConfirmationModalComponent, CurrencyPipe],
  templateUrl: './rate-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RateManagementComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;
  
  rateCategories = this.dataService.rateCategories;
  selectedCategoryId = signal<string | null>(null);
  
  selectedCategory = computed(() => {
    const catId = this.selectedCategoryId();
    if (catId === null) return null;
    return this.rateCategories().find(cat => cat.id === catId) ?? null;
  });

  currentRates = computed(() => {
    return this.selectedCategory()?.rates.sort((a,b) => a.taskCode.localeCompare(b.taskCode)) || [];
  });

  uploadStatus = signal<'idle' | 'processing' | 'success' | 'error'>('idle');
  uploadMessage = signal('');
  
  showCategoryModal = signal(false);
  isSavingCategory = signal(false);
  categoryToEdit: WritableSignal<RateCategory | null> = signal(null);
  categoryForm: FormGroup;

  showRateModal = signal(false);
  isSavingRate = signal(false);
  rateToEdit: WritableSignal<Rate | null> = signal(null);
  rateForm: FormGroup;
  
  // Signals for confirmation modals
  showDeleteRateConfirm = signal(false);
  rateToDelete = signal<Rate | null>(null);
  
  showDeleteCategoryConfirm = signal(false);
  categoryToDelete = signal<RateCategory | null>(null);

  showFormatHelp = signal(false);

  constructor() {
    this.fb = inject(FormBuilder);
    this.categoryForm = this.fb.group({ name: ['', Validators.required] });
    this.rateForm = this.fb.group({ rate: ['', [Validators.required, Validators.min(0)]] });

    effect(() => {
      const categories = this.rateCategories();
      const selectedId = this.selectedCategoryId();
      if (categories.length > 0 && selectedId === null) {
        this.selectedCategoryId.set(categories[0].id);
      }
      if (selectedId !== null && !categories.some(c => c.id === selectedId)) {
        this.selectedCategoryId.set(categories[0]?.id || null);
      }
    });
  }

  selectCategory(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.selectedCategoryId.set(select.value);
    this.uploadStatus.set('idle');
  }

  openCategoryModal(category: RateCategory | null = null) {
    this.categoryToEdit.set(category);
    this.categoryForm.reset(category ? { name: category.name } : {});
    this.showCategoryModal.set(true);
  }

  closeCategoryModal() {
    this.showCategoryModal.set(false);
  }

  async saveCategory() {
    if (this.categoryForm.invalid) return;
    this.isSavingCategory.set(true);
    
    const name = this.categoryForm.value.name;
    const editingCategory = this.categoryToEdit();
    
    try {
      if (editingCategory) {
        await this.dataService.updateRateCategory(String(editingCategory.id), name);
        this.notificationService.showSuccess(`Category '${name}' updated.`);
      } else {
        await this.dataService.addRateCategory(name);
        this.notificationService.showSuccess(`Category '${name}' created.`);
        const newCategory = this.rateCategories().find(c => c.name === name);
        if (newCategory) this.selectedCategoryId.set(newCategory.id);
      }
      this.closeCategoryModal();
    } catch (error) {
       const msg = error instanceof Error ? error.message : String(error);
       this.notificationService.showError(msg);
    } finally {
      this.isSavingCategory.set(false);
    }
  }

  deleteCategory(category: RateCategory): void {
    console.log(`[Rate Mgt] 1. Delete category button clicked for ID: ${category.id}`);
    console.log(`[Rate Mgt] 2. Category to delete:`, JSON.parse(JSON.stringify(category)));
    this.categoryToDelete.set(category);
    this.showDeleteCategoryConfirm.set(true);
  }

  async handleCategoryDelete(confirmed: boolean): Promise<void> {
    const category = this.categoryToDelete();
    this.showDeleteCategoryConfirm.set(false);

    if (confirmed && category) {
      console.log(`[Rate Mgt] 3. User confirmed deletion for category '${category.name}'.`);
      try {
        await this.dataService.deleteRateCategory(String(category.id));
        this.notificationService.showSuccess(`Category '${category.name}' deleted.`);
        console.log(`[Rate Mgt] 4. ✅ Successfully called dataService.deleteRateCategory for ID: ${category.id}`);
      } catch (error) {
        console.error(`[Rate Mgt] 5. ❌ Error deleting category ID ${category.id}:`, error);
        const msg = error instanceof Error ? error.message : String(error);
        this.notificationService.showError(msg);
      }
    } else {
        console.log(`[Rate Mgt] 3. User cancelled deletion for category ID: ${category?.id}`);
    }
    this.categoryToDelete.set(null);
  }

  openRateModal(rate: Rate) {
    this.rateToEdit.set(rate);
    this.rateForm.patchValue({ rate: rate.rate });
    this.showRateModal.set(true);
  }

  closeRateModal() {
    this.showRateModal.set(false);
  }

  async saveRate() {
    if (this.rateForm.invalid) return;
    this.isSavingRate.set(true);

    const category = this.selectedCategory();
    const editingRate = this.rateToEdit();
    if (!category || !editingRate) {
        this.isSavingRate.set(false);
        return;
    }

    const newRateValue = parseFloat(this.rateForm.value.rate);
    const updatedRates = this.currentRates().map(r => r.taskCode === editingRate.taskCode ? { ...r, rate: newRateValue } : r);

    try {
        await this.dataService.updateRatesForCategory(String(category.id), updatedRates);
        this.notificationService.showSuccess(`Rate for '${editingRate.taskCode}' updated.`);
        this.closeRateModal();
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.notificationService.showError(msg);
    } finally {
        this.isSavingRate.set(false);
    }
  }

  deleteRate(taskCode: string): void {
    console.log(`[Rate Mgt] 1. Delete rate button clicked for task code: ${taskCode}`);
    const rate = this.currentRates().find(r => r.taskCode === taskCode);
    if (!rate) {
        console.error(`[Rate Mgt] ❌ ERROR: Cannot delete rate, no rate found for task code: ${taskCode}`);
        return;
    }
    console.log(`[Rate Mgt] 2. Rate to delete:`, JSON.parse(JSON.stringify(rate)));
    this.rateToDelete.set(rate);
    this.showDeleteRateConfirm.set(true);
  }
  
  async handleRateDelete(confirmed: boolean): Promise<void> {
    const rate = this.rateToDelete();
    const category = this.selectedCategory();
    this.showDeleteRateConfirm.set(false);

    if (confirmed && rate && category) {
      console.log(`[Rate Mgt] 3. User confirmed deletion for rate '${rate.taskCode}'.`);
      try {
        const updatedRates = this.currentRates().filter(r => r.taskCode !== rate.taskCode);
        await this.dataService.updateRatesForCategory(String(category.id), updatedRates);
        this.notificationService.showSuccess(`Rate for '${rate.taskCode}' deleted.`);
        console.log(`[Rate Mgt] 4. ✅ Successfully deleted rate for task code: ${rate.taskCode}`);
      } catch (error) {
        console.error(`[Rate Mgt] 5. ❌ Error deleting rate for task code ${rate.taskCode}:`, error);
        const msg = error instanceof Error ? error.message : 'Failed to delete rate.';
        this.notificationService.showError(msg);
      }
    } else {
        console.log(`[Rate Mgt] 3. Deletion cancelled for task code: ${rate?.taskCode}`);
    }
    this.rateToDelete.set(null);
  }

  onFileSelected(event: Event): void {
    const catId = this.selectedCategoryId();
    if (catId === null) {
      this.notificationService.showError('Please select a category before uploading.');
      return;
    }

    const input = event.target as HTMLInputElement;
    if (!input.files?.[0]) return;
    const file = input.files[0];
    this.uploadStatus.set('processing');
    this.uploadMessage.set(`Processing ${file.name}...`);

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

        const result = this.processRateSheet(jsonData);

        if (result.success) {
          await this.dataService.updateRatesForCategory(String(catId), result.rates);
          this.uploadStatus.set('success');
          this.uploadMessage.set(`Successfully replaced ${result.rates.length} rates.`);
        } else {
          throw new Error(result.message);
        }
      } catch (error) {
        this.uploadStatus.set('error');
        this.uploadMessage.set(error instanceof Error ? error.message : 'Failed to process file.');
      } finally {
         input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  private processRateSheet(data: any[]): { success: boolean; message?: string; rates: Rate[] } {
    if (!data || data.length === 0) return { success: false, message: 'File is empty.', rates: [] };
    
    const headers = Object.keys(data[0] || {});
    const taskCodeHeader = headers.find(h => h.toLowerCase().includes('task code'));
    const rateHeader = headers.find(h => h.toLowerCase().includes('rate'));

    if (!taskCodeHeader || !rateHeader) return { success: false, message: `Missing 'Task Code' and/or 'Rate' columns.`, rates: [] };
    
    const rateMap = new Map<string, number>();
    for (const [index, row] of data.entries()) {
      const taskCode = row[taskCodeHeader];
      const rate = row[rateHeader];

      if (taskCode === undefined || rate === undefined) continue;
      
      const taskCodeStr = String(taskCode).trim();
      if (!taskCodeStr) continue;

      const parsedRate = parseFloat(String(rate).replace(/[^0-9.-]+/g,""));
      if (isNaN(parsedRate)) return { success: false, message: `Invalid rate in row ${index + 2}.`, rates: [] };

      // Use map to handle duplicates, last one wins. This ensures uniqueness.
      rateMap.set(taskCodeStr, parsedRate);
    }

    const newRates = Array.from(rateMap.entries()).map(([taskCode, rate]) => ({ taskCode, rate }));
    return { success: true, rates: newRates };
  }
}
