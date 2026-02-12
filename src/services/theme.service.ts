import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private platformId = inject(PLATFORM_ID);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // Always ensure the 'dark' class is removed, effectively enforcing light theme.
      document.documentElement.classList.remove('dark');
      // Clear any previously stored theme preference.
      localStorage.removeItem('theme');
    }
  }
}
