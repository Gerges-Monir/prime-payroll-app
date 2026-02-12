import { Injectable, computed, inject } from '@angular/core';
import { DatabaseService } from './database.service';

const PRIME_COMMUNICATION_LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNzUiIHZpZXdCb3g9IjAgMCAzMDAgNzUiPgo8c3R5bGU+CkBpbXBvcnQgdXJsKCdodHRwczovL2ZvbnRzLmdvb2dsZWFwaXMuY29tL2NzczI/ZmFtaWx5PU1hbnJvcGU6d2dodEA0MDAsNTAwLDYwMCw3MDAmZGlzcGxheT1zd2FwJyk7Cjwvc3R5bGU+CiAgPGc+CiAgICA8cGF0aCBmaWxsPSIjMjU2M0VCIiBkPSJNMTguMTUgMzAuMDYySDIuMjI3di01LjQ1NWwxMy4zMi0xMS45MDloMTAuMDkydjI4LjA2OEgzMC43NTVWMTguOTI1TDE4LjE1IDMwLjA2MnpNMi4yMjcgMzguOTc3aDE1LjkyVjU1SDIuMjI3di0xNi4wMjN6Ii8+CiAgICA8dGV4dCB4PSI0NiIgeT0iNDIuNSIgZm9udC1mYW1pbHk9Ik1hbnJvcGUsc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNiIgbGV0dGVyLXNwYWNpbmc9Ii0uNSIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iIzFlMjkyYiI+UFJJTUU8L3RleHQ+CiAgICA8dGV4dCB4PSIxMzQiIHk9IjQyLjUiIGZvbnQtZmFtaWx5PSJNYW5yb3BlLHNhbnMtc2VyaWYiIGZvbnQtc2lplPSIyNiIgbGV0dGVyLXNwYWNpbmc9Ii0uNSIgZm9udC13ZWlnaHQ9IjUwMCIgZmlsbD0iIzFlMjkyYiI+Q09NTVVOSUNBVElPTjwvdGV4dD4KICAgIDx0ZXh0IHg9IjQ2IiB5PSI1Ni41IiBmb250LWZhbWlseT0iTWFucm9wZSxzYW5zLXNlcmlmIiBmb250LXNpemU9IjEwIiBsZXR0ZXItc3BhY2luZz0iMSIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iIzY0NzQ4YiI+V0lSRSBZT1VSIFdPUkxEITwvdGV4dD4KICA8L2c+Cjwvc3ZnPg==';

export interface AppSettings {
  id?: string; // Firestore document ID
  logoUrl: string;
  companyName: string;
  companyAddress1: string;
  companyAddress2: string;
  companyEmail: string;
  companyPhone: string;
  partners?: { name: string; logoUrl: string; }[];
  facebookUrl?: string;
  linkedinUrl?: string;
}

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private dataService = inject(DatabaseService);

  settings = computed<AppSettings>(() => {
    const settingsFromDb = this.dataService.settings();
    if (settingsFromDb && settingsFromDb.length > 0) {
      return settingsFromDb[0];
    }
    return this.getDefaults(); // Fallback
  });

  constructor() {
    // Data loading is now handled by DatabaseService's real-time listener.
    // Seeding initial data is handled by the DatabaseService constructor.
  }

  private getDefaults(): AppSettings {
    return {
      logoUrl: PRIME_COMMUNICATION_LOGO,
      companyName: 'Prime Communication LLC',
      companyAddress1: '83 Lincoln west dr',
      companyAddress2: 'Mountville pa 17554',
      companyEmail: 'info@primecom.com',
      companyPhone: '555-555-5555',
      partners: [
        { name: 'Optimum', logoUrl: 'https://logo.clearbit.com/optimum.com' },
        { name: 'Glo Fiber', logoUrl: 'https://logo.clearbit.com/glofiber.com' }
      ],
      facebookUrl: 'https://facebook.com',
      linkedinUrl: 'https://linkedin.com',
    };
  }

  saveLogo(logoBase64: string): void {
    if (!logoBase64 || !logoBase64.startsWith('data:image')) {
        console.error('Attempted to save invalid logo data.');
        return;
    }
    this.updateSettings({ logoUrl: logoBase64 });
  }

  updateSettings(newSettings: Partial<AppSettings>): void {
    const updatedSettings = { ...this.settings(), ...newSettings };
    this.dataService.updateSettings(updatedSettings as AppSettings);
  }

  resetToDefault(): void {
    const defaults = this.getDefaults();
    this.dataService.updateSettings(defaults);
  }
}
