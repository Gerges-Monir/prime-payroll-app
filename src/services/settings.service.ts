import { Injectable, signal, effect } from '@angular/core';

const DEFAULT_LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNzUiIHZpZXdCb3g9IjAgMCAzMDAgNzUiPgo8c3R5bGU+CkBpbXBvcnQgdXJsKCdodHRwczovL2ZvbnRzLmdvb2dsZWFwaXMuY29tL2NzczI/ZmFtaWx5PU1hbnJvcGU6d2dodEA0MDAsNTAwLDYwMCw3MDAmZGlzcGxheT1zd2FwJyk7Cjwvc3R5bGU+CiAgPGc+CiAgICA8cGF0aCBmaWxsPSIjMjU2M0VCIiBkPSJNMTguMTUgMzAuMDYySDIuMjI3di01LjQ1NWwxMy4zMi0xMS45MDloMTAuMDkydjI4LjA2OEgzMC43NTVWMTguOTI1TDE4LjE1IDMwLjA2MnpNMi4yMjcgMzguOTc3aDE1LjkyVjU1SDIuMjI3di0xNi4wMjN6Ii8+CiAgICA8dGV4dCB4PSI0NiIgeT0iNDIuNSIgZm9udC1mYW1pbHk9Ik1hbnJvcGUsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNiIgbGV0dGVyLXNwYWNpbmc9Ii0uNSIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iIzFlMjkyYiI+UFJJTUU8L3RleHQ+CiAgICA8dGV4dCB4PSIxMzQiIHk9IjQyLjUiIGZvbnQtZmFtaWx5PSJNYW5yb3BlLHNhbnMtc2VyaWYiIGZvbnQtc2lplPSIyNiIgbGV0dGVyLXNwYWNpbmc9Ii0uNSIgZm9udC13ZWlnaHQ9IjUwMCIgZmlsbD0iIzFlMjkyYiI+Q09NTVVOSUNBVElPTjwvdGV4dD4KICAgIDx0ZXh0IHg9IjQ2IiB5PSI1Ni41IiBmb250LWZhbWlseT0iTWFucm9wZSxzYW5zLXNlcmlmIiBmb250LXNpemU9IjEwIiBsZXR0ZXItc3BhY2luZz0iMSIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iIzY0NzQ4YiI+V0lSRSBZT1VSIFdPUkxEITwvdGV4dD4KICA8L2c+Cjwvc3ZnPg==';
const STORAGE_KEY = 'primePayroll_settings';

export interface AppSettings {
  logoUrl: string;
}

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  settings = signal<AppSettings>({ logoUrl: DEFAULT_LOGO });

  constructor() {
    this.loadSettings();
    effect(() => {
      this.saveSettings(this.settings());
    });
  }

  private loadSettings(): void {
    try {
      const storedSettings = localStorage.getItem(STORAGE_KEY);
      if (storedSettings) {
        this.settings.set(JSON.parse(storedSettings));
      } else {
        this.settings.set({ logoUrl: DEFAULT_LOGO });
      }
    } catch (e) {
      console.error('Error loading settings from localStorage', e);
      this.settings.set({ logoUrl: DEFAULT_LOGO });
    }
  }

  private saveSettings(settings: AppSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Error saving settings to localStorage', e);
    }
  }

  saveLogo(logoBase64: string): void {
    this.settings.update(s => ({ ...s, logoUrl: logoBase64 }));
  }
}
