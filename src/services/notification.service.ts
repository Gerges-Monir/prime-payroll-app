import { Injectable, signal } from '@angular/core';
import { Notification, NotificationType } from '../models/payroll.model';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  notifications = signal<Notification[]>([]);

  show(message: string, type: NotificationType = 'success', duration: number = 4000) {
    const newNotification: Notification = {
      id: Date.now(),
      message,
      type,
    };

    this.notifications.update(current => [...current, newNotification]);

    setTimeout(() => {
      this.remove(newNotification.id);
    }, duration);
  }

  showSuccess(message: string) {
    this.show(message, 'success');
  }

  showError(message: string) {
    this.show(message, 'error', 6000); // Show errors for a bit longer
  }

  remove(id: number) {
    this.notifications.update(current => current.filter(n => n.id !== id));
  }
}
