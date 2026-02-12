// This file can be replaced during build by using the `fileReplacements` array.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  firebase: {
    apiKey: (process.env as any).API_KEY,
    authDomain: "prime-payroll.firebaseapp.com",
    projectId: "prime-payroll",
    storageBucket: "prime-payroll.firebasestorage.app",
    messagingSenderId: "259012361484",
    appId: "1:259012361484:web:00ed54b5f306a8b232dd29",
    measurementId: "G-510D4TWQBP"
  },
  cloudFunctionUrl: 'https://send-payroll-email-910110553526.us-central1.run.app',
  // IMPORTANT: This key must be replaced with the Site Key from your
  // Google reCAPTCHA admin console after you have deployed the site for the first time.
  recaptchaSiteKey: '6LdNrWgsAAAAALa_lEAGV2LyuAMQwgxhidX8PHLy'
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included for legacy support, not needed for zoneless apps