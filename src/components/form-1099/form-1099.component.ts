import { Component, ChangeDetectionStrategy, input, ElementRef, inject, viewChild, output } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { User } from '../../models/payroll.model';
import { AppSettings } from '../../services/settings.service';
import { NotificationService } from '../../services/notification.service';

declare var jspdf: any;
declare var html2canvas: any;

export interface Recipient1099 {
  name: string;
  tin?: string;
  address: string;
  fullAddress?: string;
}

export interface Payer1099 {
  logoUrl: string;
  name: string;
  tin?: string;
  address: string;
}

@Component({
  selector: 'app-form-1099',
  standalone: true,
  imports: [CommonModule, CurrencyPipe],
  templateUrl: './form-1099.component.html',
  styleUrls: ['./form-1099.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Form1099Component {
  private notificationService = inject(NotificationService);

  payer = input.required<Payer1099>();
  recipient = input.required<Recipient1099>();
  compensation = input.required<number>();
  year = input.required<number>();

  detailsClicked = output<void>();
  formElement = viewChild<ElementRef>('formContainer');

  async downloadAsPdf() {
    const element = this.formElement()?.nativeElement;
    if (!element) {
      this.notificationService.showError('Could not find form element to download.');
      return;
    }

    this.notificationService.show('Generating PDF...', 'info');

    try {
      const canvas = await html2canvas(element, {
        scale: 2, // Increase resolution
        useCORS: true,
      });

      const imgData = canvas.toDataURL('image/png');
      const { jsPDF } = jspdf;
      
      // PDF dimensions based on a standard letter size page (8.5x11 inches) at 72 dpi
      const pdfWidth = 612; 
      const pdfHeight = 792; 
      const doc = new jsPDF('p', 'pt', 'letter');
      
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = imgWidth / imgHeight;

      // Fit the image to the width of the page, maintaining aspect ratio
      const finalWidth = pdfWidth - 40; // with some margin
      const finalHeight = finalWidth / ratio;
      
      doc.addImage(imgData, 'PNG', 20, 40, finalWidth, finalHeight);
      doc.save(`Earnings_Summary_${this.year()}_${this.recipient().name.replace(/\s/g, '_')}.pdf`);
      this.notificationService.showSuccess('PDF download started.');
    } catch (error) {
      console.error('Error generating PDF:', error);
      this.notificationService.showError('An error occurred while generating the PDF.');
    }
  }
}