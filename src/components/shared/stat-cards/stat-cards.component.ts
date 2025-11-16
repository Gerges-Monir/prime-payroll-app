import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatCard } from '../../../models/payroll.model';

@Component({
  selector: 'app-stat-cards',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stat-cards.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatCardsComponent {
  stats = input.required<StatCard[]>();
}