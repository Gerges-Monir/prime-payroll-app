import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './src/app.component';
import { provideZonelessChangeDetection } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(),
    CurrencyPipe,
    DatePipe,
  ],
}).catch(err => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.