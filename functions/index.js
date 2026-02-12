const functions = require('@google-cloud/functions-framework');
const nodemailer = require('nodemailer');
const cors = require('cors')({ origin: true });
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// IMPORTANT: Your project ID is required here.
// It will be automatically available in the Cloud Functions environment
// if you deploy this from the same Google Cloud project as your Firebase project.
try {
  admin.initializeApp({
    projectId: process.env.GCP_PROJECT, // Standard environment variable in GCF
  });
} catch (e) {
  console.error('Firebase Admin SDK initialization error. Ensure function is in the correct project.', e);
}


// Configure the Nodemailer transporter using environment variables.
// IMPORTANT: You MUST set these environment variables in your Cloud Function's configuration.
// DO NOT hardcode credentials here.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,     // e.g., 'smtp.gmail.com' or your transactional email provider's host
  port: parseInt(process.env.SMTP_PORT || '587', 10), // e.g., 587 or 465
  secure: (process.env.SMTP_PORT === '465'), // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER, // Your email address (e.g., info@yourcompany.com)
    pass: process.env.SMTP_PASS, // Your email password or app-specific password
  },
});

/**
 * HTTP Cloud Function that sends an email.
 *
 * @param {Object} req The request object.
 * @param {Object} res The response object.
 */
functions.http('sendEmail', async (req, res) => {
  // Use CORS middleware to handle preflight requests and set CORS headers.
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    // --- Authentication & Authorization ---
    const authorization = req.headers.authorization;
    // Requests from logged-in users (e.g., sending a paystub) will have an Authorization header.
    if (authorization && authorization.startsWith('Bearer ')) {
      const idToken = authorization.split('Bearer ')[1];
      try {
        // Verify the ID token to ensure the request is from an authenticated user.
        await admin.auth().verifyIdToken(idToken);
        console.log('Authenticated request successfully verified.');
      } catch (error) {
        console.error('Error verifying Firebase ID token:', error);
        return res.status(403).send('Unauthorized');
      }
    } else {
       // This is a public request (e.g., from the contact form).
       // IMPORTANT: It's highly recommended to protect this function with
       // Firebase App Check in your Firebase console to prevent abuse and spam.
       console.log('Processing public (unauthenticated) request.');
    }

    // --- Email Sending Logic ---
    const { to, subject, html } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).send('Missing required fields: to, subject, or html.');
    }

    const mailOptions = {
      from: `Prime Communication <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      html: html,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('Email sent successfully to:', to);
      res.status(200).send('Email sent successfully.');
    } catch (error) {
      console.error('Error sending email:', error);
      res.status(500).send('Error sending email.');
    }
  });
});
