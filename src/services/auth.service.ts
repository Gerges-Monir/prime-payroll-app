import { Injectable, signal, inject } from '@angular/core';
import { User } from '../models/payroll.model';
import { MockDataService } from './mock-data.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private dataService = inject(MockDataService);
  currentUser = signal<User | null>(null);

  login(username: string, password?: string): { success: boolean, message?: string } {
    const user = this.dataService.users().find(u => u.username.toLowerCase() === username.toLowerCase());
    
    if (!user) {
      return { success: false, message: 'User not found.' };
    }

    if (user.password !== password) {
       return { success: false, message: 'Incorrect password.' };
    }

    this.currentUser.set(user);
    return { success: true };
  }

  logout(): void {
    this.currentUser.set(null);
  }
}