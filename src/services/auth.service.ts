import { Injectable, signal, inject, effect, Injector, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { User } from '../models/payroll.model';
import { DatabaseService } from './database.service';
import { environment } from '../environments/environment';
import { NotificationService } from './notification.service';

// These are imported from the global scope from index.html
declare var firebase: any;

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private notificationService = inject(NotificationService);
  private injector = inject(Injector);
  private platformId = inject(PLATFORM_ID);
  private dataService!: DatabaseService;
  
  currentUser = signal<User | null>(null);
  isInitializing = signal(true);
  isConfigured = signal(true);
  firebaseError = signal<string | null>(null);

  private auth: any;

  constructor() {
    // 1. Check if Firebase SDK loaded at all.
    if (typeof firebase === 'undefined' || !firebase.app) {
      console.error("[Auth] 🚨 Firebase SDK not loaded. The application cannot start.");
      this.isConfigured.set(false);
      this.isInitializing.set(false);
      this.firebaseError.set('CRITICAL: The Firebase SDK failed to load. The application cannot connect to backend services.');
      return;
    }
    
    // 2. Check for API key existence.
    if (!environment.firebase.apiKey) {
      console.error("[Auth] 🚨 Firebase API Key is missing.");
      this.isConfigured.set(false);
      this.isInitializing.set(false);
      return;
    }

    // 3. Main initialization block
    try {
      // Initialize the app itself
      if (!firebase.apps.length) {
        firebase.initializeApp(environment.firebase);
      }

      // Initialize App Check immediately after. This is the most likely point of failure on a new deployment.
      if (isPlatformBrowser(this.platformId)) {
        if (!environment.recaptchaSiteKey) {
            throw new Error("reCAPTCHA site key is missing from environment configuration.");
        }
        const appCheck = firebase.appCheck();
        appCheck.activate(environment.recaptchaSiteKey, true);
        console.log('[Auth] ✅ Firebase App Check activated.');
      }

      // If App Check was successful, proceed to other services.
      this.auth = firebase.auth();

      // Listen for authentication state changes
      this.auth.onAuthStateChanged(async (firebaseUser: any) => {
        if (!this.dataService) {
          this.dataService = this.injector.get(DatabaseService);
        }
        
        this.isInitializing.set(true);
        if (firebaseUser) {
          try {
            let user = await this.dataService.getUserByUid(firebaseUser.uid);
            
            if (!user) {
              user = await this.dataService.getUserByEmail(firebaseUser.email);
              if (user && !user.uid) {
                await this.dataService.updateUser({ ...user, uid: firebaseUser.uid });
                user.uid = firebaseUser.uid;
              }
            }
            
            if (!user) {
              const unlinkedAdmin = await this.dataService.getUnlinkedAdmin();
              if (unlinkedAdmin) {
                user = { 
                  ...unlinkedAdmin, 
                  uid: firebaseUser.uid, 
                  email: firebaseUser.email
                };
                await this.dataService.updateUser(user);
              }
            }

            if (user) {
              this.currentUser.set(user);
              await this.dataService.initialize(user); 
            } else {
              const authEmail = firebaseUser.email;
              console.error(`Authenticated user ${authEmail} not found in Firestore. Logging out.`);
              this.notificationService.show(`Your user profile was not found. Please contact an administrator.`, 'error', 10000);
              await this.logout();
            }
          } catch (error) {
             console.error("Error fetching user profile:", error);
             this.notificationService.show('Could not connect to the user database due to a permission error.', 'error', 10000);
             await this.logout();
          }
        } else {
          this.currentUser.set(null);
          if (this.dataService) {
              this.dataService.cleanup();
          }
        }
        this.isInitializing.set(false);
      });

    } catch (e: any) {
        // This single catch block now handles BOTH general init errors AND App Check activation errors.
        console.error("[Auth] 🚨 Firebase initialization failed.", e);
        
        let errorMessage = `CRITICAL: Firebase initialization failed. Please check that the API_KEY environment variable is correct and that the Firebase project settings (like authDomain: "${environment.firebase.authDomain}") match your project configuration.`;

        // Check for the specific App Check error message. This is common on new deployments.
        if (e && e.message && (e.message.includes('reCAPTCHA') || e.message.includes('AppCheck') || e.message.includes('app-check'))) {
            errorMessage = `CRITICAL: Firebase App Check failed to activate.\nThis is expected on a new deployment and means your website's domain is not yet whitelisted in Firebase.\n\nACTION REQUIRED:\n1. Go to your Firebase Project -> App Check -> Apps.\n2. Find your web app in the list.\n3. Click the overflow menu (...) and select "Manage App Attestations".\n4. Under "Domain Protection", add your new domain and save.\n5. Redeploy the application.`;
        }

        this.firebaseError.set(errorMessage);
        this.isConfigured.set(false);
        this.isInitializing.set(false);
        return; // CRITICAL: Stop execution here.
    }
  }

  async login(email: string, password?: string): Promise<{ success: boolean, message?: string }> {
    if (!password) {
      return { success: false, message: 'Password is required.' };
    }
    
    try {
      await this.auth.signInWithEmailAndPassword(email, password);
      return { success: true };
    } catch (error: any) {
      return { success: false, message: this.mapAuthError(error.code) };
    }
  }

  async logout(): Promise<void> {
    await this.auth.signOut();
  }

  async createUser(email: string, password: string): Promise<{ success: boolean; uid?: string; message?: string }> {
    try {
        const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
        return { success: true, uid: userCredential.user.uid };
    } catch (error: any) {
        return { success: false, message: this.mapAuthError(error.code) };
    }
  }

  async sendPasswordResetEmail(email: string): Promise<{ success: boolean; message?: string }> {
    try {
      await this.auth.sendPasswordResetEmail(email);
      return { success: true };
    } catch (error: any) {
      return { success: false, message: this.mapAuthError(error.code) };
    }
  }

  async getIdToken(): Promise<string | null> {
    if (this.auth.currentUser) {
      return this.auth.currentUser.getIdToken();
    }
    return null;
  }

  private mapAuthError(code: string): string {
    switch (code) {
      case 'auth/user-not-found':
        return 'User not found with that email address.';
      case 'auth/invalid-email':
        return 'The email address is not valid.';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Incorrect email or password.';
      case 'auth/too-many-requests':
        return 'Access has been temporarily disabled due to too many failed login attempts. Please try again later.';
      case 'auth/email-already-in-use':
        return 'This email address is already in use by another account.';
      case 'auth/weak-password':
        return 'The password is too weak. It must be at least 6 characters long.';
      default:
        console.error('Firebase Auth Error:', code);
        return 'An unexpected authentication error occurred.';
    }
  }
}