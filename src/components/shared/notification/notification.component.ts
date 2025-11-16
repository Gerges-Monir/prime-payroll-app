import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../../services/notification.service';

@Component({
  selector: 'app-notification',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Note: Angular animations are not supported in this environment.
  // We will rely on TailwindCSS for animations.
})
export class NotificationComponent {
  private notificationService = inject(NotificationService);
  notifications = this.notificationService.notifications;

  removeNotification(id: number) {
    this.notificationService.remove(id);
  }
}
