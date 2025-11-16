import { Component, ChangeDetectionStrategy, signal, inject, computed, effect, WritableSignal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { MockDataService } from '../../services/mock-data.service';
import { Rate, RateCategory } from '../../models/payroll.model';

declare var XLSX: any;

@Component({
  selector: 'app-rate-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './rate-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RateManagementComponent {
  private dataService = inject(MockDataService);
  private fb = inject(FormBuilder);
  
  rateCategories = this.dataService.rateCategories;
  selectedCategoryId = signal<number | null>(null);
  
  // Computed property for the currently selected category object
  selectedCategory = computed(() => {
    const catId = this.selectedCategoryId();
    if (catId === null) return null;
    return this.rateCategories().find(cat => cat.id === catId) ?? null;
  });

  currentRates = computed(() => {
    return this.selectedCategory()?.rates || [];
  });

  uploadStatus = signal<'idle' | 'processing' | 'success' | 'error'>('idle');
  uploadMessage = signal('');
  
  // Category Modal State
  showCategoryModal = signal(false);
  categoryToEdit: WritableSignal<RateCategory | null> = signal(null);
  categoryForm: FormGroup;

  // Rate Modal State
  showRateModal = signal(false);
  rateToEdit: WritableSignal<Rate | null> = signal(null);
  rateForm: FormGroup;

  constructor() {
    // FIX: Removed redundant FormBuilder injection. It is already injected as a class property,
    // and having it here was causing a type inference error.
    
    this.categoryForm = this.fb.group({
      name: ['', Validators.required],
    });

    this.rateForm = this.fb.group({
      rate: ['', [Validators.required, Validators.min(0)]]
    });

    effect(() => {
      const categories = this.rateCategories();
      const selectedId = this.selectedCategoryId();
      // If categories exist but none are selected, select the first one.
      if (categories.length > 0 && selectedId === null) {
        this.selectedCategoryId.set(categories[0].id);
      }
      // If the selected category is deleted, select another one or null
      if (selectedId !== null && !categories.some(c => c.id === selectedId)) {
        this.selectedCategoryId.set(categories[0]?.id || null);
      }
    }, { allowSignalWrites: true });
  }

  selectCategory(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.selectedCategoryId.set(Number(select.value));
    this.uploadStatus.set('idle');
    this.uploadMessage.set('');
  }

  // --- CATEGORY CRUD ---
  openCategoryModal(category: RateCategory | null = null) {
    this.categoryToEdit.set(category);
    if (category) {
      this.categoryForm.patchValue({ name: category.name });
    } else {
      this.categoryForm.reset();
    }
    this.showCategoryModal.set(true);
  }

  closeCategoryModal() {
    this.showCategoryModal.set(false);
    this.categoryToEdit.set(null);
  }

  saveCategory() {
    if (this.categoryForm.invalid) return;
    
    const name = this.categoryForm.value.name;
    const editingCategory = this.categoryToEdit();
    
    try {
      if (editingCategory) {
        this.dataService.updateRateCategory(editingCategory.id, name);
      } else {
        this.dataService.addRateCategory(name);
        // Select the newly added category for better UX
        const newCategory = this.rateCategories().slice(-1)[0];
        if (newCategory) {
          this.selectedCategoryId.set(newCategory.id);
        }
      }
      this.closeCategoryModal();
    } catch (error) {
       alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  deleteCategory(categoryId: number) {
    if (confirm('Are you sure you want to delete this category and all its rates? This cannot be undone.')) {
      try {
        this.dataService.deleteRateCategory(categoryId);
      } catch (error) {
        alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // --- RATE CRUD ---
  openRateModal(rate: Rate) {
    this.rateToEdit.set(rate);
    this.rateForm.patchValue({ rate: rate.rate });
    this.showRateModal.set(true);
  }

  closeRateModal() {
    this.showRateModal.set(false);
    this.rateToEdit.set(null);
  }

  saveRate() {
    if (this.rateForm.invalid) return;
    
    const category = this.selectedCategory();
    const editingRate = this.rateToEdit();
    if (!category || !editingRate) return;

    const newRateValue = this.rateForm.value.rate;
    
    const updatedRates = this.currentRates().map(r => 
      r.taskCode === editingRate.taskCode ? { ...r, rate: newRateValue } : r
    );

    this.dataService.updateRatesForCategory(category.id, updatedRates);
    this.closeRateModal();
  }

  deleteRate(taskCode: string) {
    const category = this.selectedCategory();
    if (!category) return;

    if (confirm(`Are you sure you want to delete the rate for task code "${taskCode}"?`)) {
      const updatedRates = this.currentRates().filter(r => r.taskCode !== taskCode);
      this.dataService.updateRatesForCategory(category.id, updatedRates);
    }
  }

  // --- FILE UPLOAD ---
  onFileSelected(event: Event): void {
    const catId = this.selectedCategoryId();
    if (catId === null) {
      alert('Please select or create a rate category before uploading a file.');
      return;
    }

    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    const file = input.files[0];
    this.uploadStatus.set('processing');
    this.uploadMessage.set(`Processing ${file.name}...`);

    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const arrayBuffer = e.target.result;
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

        const result = this.processRateSheet(jsonData);

        if (result.success) {
          this.dataService.updateRatesForCategory(catId, result.rates);
          this.uploadStatus.set('success');
          this.uploadMessage.set(`Successfully processed and replaced ${result.rates.length} rates.`);
        } else {
          this.uploadStatus.set('error');
          this.uploadMessage.set(`Error: ${result.message}`);
        }

      } catch (error) {
        this.uploadStatus.set('error');
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        this.uploadMessage.set(`Error: Failed to read or parse the file. ${errorMessage}`);
      }
      input.value = ''; // Reset file input
    };
    reader.onerror = () => {
      this.uploadStatus.set('error');
      this.uploadMessage.set('Error: Could not read the selected file.');
      input.value = ''; // Reset file input
    };
    reader.readAsArrayBuffer(file);
  }

  private processRateSheet(data: any[]): { success: boolean; message?: string; rates: Rate[] } {
    if (!data || data.length === 0) {
      return { success: false, message: 'The rate sheet file is empty.', rates: [] };
    }
    
    // Find header keys for 'Task Code' and 'Rate', case-insensitively
    const headers = Object.keys(data[0] || {});
    const taskCodeHeader = headers.find(h => h.toLowerCase().includes('task code'));
    const rateHeader = headers.find(h => h.toLowerCase().includes('rate'));

    if (!taskCodeHeader || !rateHeader) {
      return { success: false, message: `Could not find 'Task Code' and/or 'Rate' columns in the file.`, rates: [] };
    }
    
    const newRates: Rate[] = [];
    for (const [index, row] of data.entries()) {
      const taskCode = row[taskCodeHeader];
      const rate = row[rateHeader];

      if (taskCode === undefined || rate === undefined) {
         console.warn(`Skipping row ${index + 2} due to missing data.`);
         continue;
      }
      
      const taskCodeStr = String(taskCode).trim();
      if (!taskCodeStr) {
          console.warn(`Skipping row ${index + 2} due to empty task code.`);
          continue;
      }

      const parsedRate = parseFloat(String(rate).replace(/[^0-9.-]+/g,""));
      if (isNaN(parsedRate)) {
        return { success: false, message: `Invalid rate value in row ${index + 2} for task code "${taskCodeStr}". Rate must be a number.`, rates: [] };
      }

      newRates.push({
        taskCode: taskCodeStr,
        rate: parsedRate
      });
    }
    return { success: true, rates: newRates };
  }
}