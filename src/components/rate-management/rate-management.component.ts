import { Component, ChangeDetectionStrategy, signal, inject, computed, effect, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { Rate, RateCategory } from '../../models/payroll.model';
import { NotificationService } from '../../services/notification.service';

declare var XLSX: any;

@Component({
  selector: 'app-rate-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './rate-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RateManagementComponent {
  private dataService = inject(DatabaseService);
  private notificationService = inject(NotificationService);
  private fb: FormBuilder;
  
  rateCategories = this.dataService.rateCategories;
  selectedCategoryId = signal<number | null>(null);
  
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
    }, { allowSignalWrites: true });
  }

  selectCategory(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.selectedCategoryId.set(Number(select.value));
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
        await this.dataService.updateRateCategory(editingCategory.id, name);
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

  async deleteCategory(categoryId: number) {
    const category = this.rateCategories().find(c => c.id === categoryId);
    if (confirm(`Are you sure you want to delete the category "${category?.name}"? Any users assigned to it will be unassigned.`)) {
      try {
        await this.dataService.deleteRateCategory(categoryId);
        this.notificationService.showSuccess(`Category '${category?.name}' deleted.`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.notificationService.showError(msg);
      }
    }
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
        await this.dataService.updateRatesForCategory(category.id, updatedRates);
        this.notificationService.showSuccess(`Rate for '${editingRate.taskCode}' updated.`);
        this.closeRateModal();
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.notificationService.showError(msg);
    } finally {
        this.isSavingRate.set(false);
    }
  }

  async deleteRate(taskCode: string) {
    const category = this.selectedCategory();
    if (!category) return;

    if (confirm(`Delete rate for task code "${taskCode}"?`)) {
      const updatedRates = this.currentRates().filter(r => r.taskCode !== taskCode);
      await this.dataService.updateRatesForCategory(category.id, updatedRates);
      this.notificationService.showSuccess(`Rate for '${taskCode}' deleted.`);
    }
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
          await this.dataService.updateRatesForCategory(catId, result.rates);
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
    
    const newRates: Rate[] = [];
    for (const [index, row] of data.entries()) {
      const taskCode = row[taskCodeHeader];
      const rate = row[rateHeader];

      if (taskCode === undefined || rate === undefined) continue;
      
      const taskCodeStr = String(taskCode).trim();
      if (!taskCodeStr) continue;

      const parsedRate = parseFloat(String(rate).replace(/[^0-9.-]+/g,""));
      if (isNaN(parsedRate)) return { success: false, message: `Invalid rate in row ${index + 2}.`, rates: [] };

      newRates.push({ taskCode: taskCodeStr, rate: parsedRate });
    }
    return { success: true, rates: newRates };
  }
}