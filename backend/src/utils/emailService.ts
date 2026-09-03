import nodemailer, { Transporter } from 'nodemailer';

// Gmail SMTP. Auth is the project Gmail address + a 16-char App Password
// (Google Account -> Security -> 2-Step Verification -> App passwords).
// No sending domain needed; replies land in the same Gmail inbox.
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_NAME = process.env.SMTP_FROM_NAME || 'HomeEase';
const FROM_EMAIL = `${FROM_NAME} <${SMTP_USER}>`;

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP_USER and SMTP_PASS must be set to send email');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
};

const send = async (to: string, subject: string, html: string, label: string): Promise<void> => {
  try {
    const info = await getTransporter().sendMail({ from: FROM_EMAIL, to, subject, html });
    console.log(`[Email] ${label} sent:`, info.messageId);
  } catch (err) {
    console.error(`[Email] Failed to send ${label}:`, err);
    throw new Error(`Failed to send ${label}: ${(err as Error).message}`);
  }
};

export const sendOtpEmail = async (email: string, otp: string): Promise<void> => {
  await send(
    email,
    'Your HomeEase Verification Code',
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4169E1;">HomeEase Email Verification</h2>
        <p>Your verification code is:</p>
        <h1 style="font-size: 48px; letter-spacing: 8px; color: #FB8B23;">${otp}</h1>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `,
    'OTP email',
  );
};

export const sendPasswordResetEmail = async (email: string, otp: string): Promise<void> => {
  await send(
    email,
    'Reset Your HomeEase Password',
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4169E1;">Password Reset Request</h2>
        <p>You requested to reset your HomeEase password. Enter this code in the app to continue:</p>
        <h1 style="font-size: 48px; letter-spacing: 8px; color: #FB8B23;">${otp}</h1>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p>If you did not request a password reset, please ignore this email.</p>
      </div>
    `,
    'password reset email',
  );
};

export const sendWelcomeEmail = async (email: string, fullName: string): Promise<void> => {
  await send(
    email,
    'Welcome to HomeEase',
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4169E1;">Welcome to HomeEase, ${fullName}!</h2>
        <p>Your account has been successfully verified. You can now access all HomeEase features.</p>
        <p>Thank you for joining us.</p>
      </div>
    `,
    'welcome email',
  );
};
