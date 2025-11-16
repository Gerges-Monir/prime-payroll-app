import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-company-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="animate-fade-in">
      <div class="flex flex-col md:flex-row justify-between md:items-start mb-6 gap-4">
        <div>
          <h2 class="text-xl font-semibold text-brand-text-primary">Company Settings</h2>
          <p class="text-brand-text-secondary">Manage your company's branding and other settings.</p>
        </div>
      </div>
      
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h3 class="text-lg font-semibold mb-2 text-brand-text-primary">Company Logo</h3>
          <p class="text-brand-text-secondary text-sm mb-4">
            Upload your company logo. This will be displayed on the login page and sidebar. Recommended aspect ratio is 4:1.
          </p>
          <div 
            class="bg-slate-50 border-2 border-dashed border-brand-border rounded-lg p-8 text-center cursor-pointer hover:border-brand-primary transition-colors duration-300" 
            (click)="fileInput.click()">
            <svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-16 w-16 text-slate-400" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" /></svg>
            <h3 class="text-lg font-semibold text-brand-text-primary mt-4">Click to browse or drop file</h3>
            <p class="text-sm text-brand-text-secondary mt-1">Supports .png, .jpg, .svg</p>
            <input type="file" #fileInput (change)="onLogoSelected($event)" accept="image/*" class="hidden">
          </div>
           @if (uploadMessage()) {
             <div class="mt-4 text-center text-sm" [class.text-green-600]="!uploadError()" [class.text-red-600]="uploadError()">
                {{ uploadMessage() }}
             </div>
           }
        </div>
        <div>
           <h3 class="text-lg font-semibold mb-2 text-brand-text-primary">Logo Preview</h3>
            <div class="bg-slate-50 border border-brand-border rounded-lg p-8 flex items-center justify-center min-h-[190px]">
                <img [src]="logoUrl()" alt="Logo Preview" class="max-h-24">
            </div>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanySettingsComponent {
  private settingsService = inject(SettingsService);
  
  logoUrl = computed(() => this.settingsService.settings().logoUrl);
  uploadMessage = signal('');
  uploadError = signal(false);

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) { // 2MB limit
      this.uploadMessage.set('Error: File size must be under 2MB.');
      this.uploadError.set(true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.settingsService.saveLogo(reader.result as string);
      this.uploadMessage.set('Logo updated successfully!');
      this.uploadError.set(false);
    };
    reader.onerror = () => {
      this.uploadMessage.set('Error: Could not read the file.');
      this.uploadError.set(true);
    };
    reader.readAsDataURL(file);
    
    // Reset file input so user can upload the same file again if they want
    input.value = '';
  }
}
