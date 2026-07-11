"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWelcomeEmail = exports.sendPasswordResetEmail = exports.sendOtpEmail = void 0;
const resend_1 = require("resend");
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const sendOtpEmail = async (email, otp) => {
    await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'Your HomeEase Verification Code',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4169E1;">HomeEase Email Verification</h2>
        <p>Your verification code is:</p>
        <h1 style="font-size: 48px; letter-spacing: 8px; color: #FB8B23;">${otp}</h1>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `,
    });
};
exports.sendOtpEmail = sendOtpEmail;
const sendPasswordResetEmail = async (email, token) => {
    const resetUrl = `${process.env.APP_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'Reset Your HomeEase Password',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4169E1;">Password Reset Request</h2>
        <p>You requested to reset your HomeEase password. Click the link below to proceed:</p>
        <a href="${resetUrl}" style="display: inline-block; background-color: #4169E1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 16px 0;">Reset Password</a>
        <p>This link expires in <strong>24 hours</strong>.</p>
        <p>If you did not request a password reset, please ignore this email.</p>
      </div>
    `,
    });
};
exports.sendPasswordResetEmail = sendPasswordResetEmail;
const sendWelcomeEmail = async (email, fullName) => {
    await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'Welcome to HomeEase',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4169E1;">Welcome to HomeEase, ${fullName}!</h2>
        <p>Your account has been successfully verified. You can now access all HomeEase features.</p>
        <p>Thank you for joining us.</p>
      </div>
    `,
    });
};
exports.sendWelcomeEmail = sendWelcomeEmail;
//# sourceMappingURL=emailService.js.map