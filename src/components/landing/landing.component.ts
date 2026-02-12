import { Component, ChangeDetectionStrategy, output, inject, computed, AfterViewInit, ElementRef, Renderer2, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { SettingsService } from '../../services/settings.service';
import { ContactFormComponent } from '../shared/contact-form/contact-form.component';
import { CareerFormComponent } from '../shared/career-form/career-form.component';
import { DatabaseService } from '../../services/database.service';
import { JobOpening } from '../../models/payroll.model';
import { JobOpeningsListComponent } from '../shared/job-openings-list/job-openings-list.component';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, ContactFormComponent, CareerFormComponent, DatePipe, JobOpeningsListComponent],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:scroll)': 'onWindowScroll()',
  }
})
export class LandingComponent implements AfterViewInit {
  private settingsService = inject(SettingsService);
  private elementRef = inject(ElementRef);
  private renderer = inject(Renderer2);
  private databaseService = inject(DatabaseService);

  loginClicked = output<void>();

  companySettings = this.settingsService.settings;
  currentYear = new Date().getFullYear();

  // Job Openings
  jobOpenings = this.databaseService.jobOpenings;
  activeJobOpenings = computed(() => 
    this.jobOpenings().filter(j => j.isActive).sort((a, b) => new Date(b.datePosted).getTime() - new Date(a.datePosted).getTime())
  );

  isScrolled = signal(false);
  showContactModal = signal(false);
  
  // Career Modal State
  showCareerModal = signal(false);
  jobToApplyFor = signal<JobOpening | null>(null);

  // Opportunities Modal State
  showOpportunitiesModal = signal(false);

  logoErrors = signal(new Set<string>());

  ngAfterViewInit(): void {
    this.animateMotto();
    this.setupScrollAnimations();
    this.setupSmoothScroll();
  }

  onWindowScroll(): void {
    const offset = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    this.isScrolled.set(offset > 20);
  }

  onLogoError(partnerName: string): void {
    this.logoErrors.update(errors => {
      errors.add(partnerName);
      return new Set(errors); // Return a new set to trigger change detection
    });
  }

  // --- methods for careers ---
  openApplicationFor(job: JobOpening): void {
    this.jobToApplyFor.set(job);
    this.showCareerModal.set(true);
  }

  handleApplyForJob(job: JobOpening): void {
    this.showOpportunitiesModal.set(false);
    // Use a small timeout to allow the first modal to close smoothly before opening the next
    setTimeout(() => {
        this.openApplicationFor(job);
    }, 150);
  }

  private animateMotto(): void {
    const mottoText = this.elementRef.nativeElement.querySelector('#motto-text');
    const animationContainer = this.elementRef.nativeElement.querySelector('#plug-animation-container');

    if (!mottoText || !animationContainer) return;
    
    // Use a small delay to ensure elements are ready
    setTimeout(() => {
        this.renderer.addClass(mottoText, 'animate');
        this.renderer.addClass(animationContainer, 'animate');
    }, 300);
  }

  private setupScrollAnimations(): void {
    const sections = this.elementRef.nativeElement.querySelectorAll('.scroll-animate');
    if (typeof IntersectionObserver === 'undefined') {
        sections.forEach((section: Element) => this.renderer.addClass(section, 'is-visible'));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.renderer.addClass(entry.target, 'is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    sections.forEach((section: Element) => observer.observe(section));
  }

  private setupSmoothScroll(): void {
    const anchors = this.elementRef.nativeElement.querySelectorAll('a[href^="#"]');
    anchors.forEach((anchor: HTMLAnchorElement) => {
      this.renderer.listen(anchor, 'click', (event: Event) => {
        event.preventDefault();
        const href = anchor.getAttribute('href');
        if (href) {
          const target = this.elementRef.nativeElement.querySelector(href);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    });
  }
}