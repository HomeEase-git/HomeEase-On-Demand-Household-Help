import express from 'express';
import cors from 'cors';
import authRoutes from '@routes/auth';
import workerRoutes from '@routes/workers';
import bookingRoutes from '@routes/bookings';
import paymentRoutes from '@routes/payments';
import userRoutes from '@routes/users';
import messageRoutes from '@routes/messages';
import notificationRoutes from '@routes/notifications';
import serviceRoutes from '@routes/services';
import verificationRoutes from '@routes/verification';
import adminUserRoutes from '@routes/adminUsers';
import adminBookingRoutes from '@routes/adminBookings';
import adminPaymentRoutes from '@routes/adminPayments';
import adminReviewRoutes from '@routes/adminReviews';
import adminDisputeRoutes from '@routes/adminDisputes';
import adminVerificationRoutes from '@routes/adminVerifications';
import adminDashboardRoutes from '@routes/adminDashboard';
import adminAnalyticsRoutes from '@routes/adminAnalytics';
import adminPricingRuleRoutes from '@routes/adminPricingRules';
import adminServiceTypeRoutes from '@routes/adminServiceTypes';
import adminAuditLogRoutes from '@routes/adminAuditLogs';
import adminReportsRoutes from '@routes/adminReports';
import adminSettingsRoutes from '@routes/adminSettings';
import { errorHandler } from '@middleware/errorHandler';

const app = express();
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '1mb';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Middleware
// PayMongo webhook signature verification needs the raw request bytes, so these
// routes must capture them before the global JSON parser consumes the stream.
// The transfer callback is assumed to be signed the same way as the collections
// webhook (Paymongo-Signature HMAC) — confirm against a real payload once
// PayMongo's Wallet/Disbursements product is enabled and adjust if it differs.
app.use('/api/payments/paymongo/webhook', express.raw({ type: 'application/json' }));
app.use('/api/payments/paymongo/transfers/callback', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonBodyLimit }));
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/bookings', adminBookingRoutes);
app.use('/api/admin/payments', adminPaymentRoutes);
app.use('/api/admin/reviews', adminReviewRoutes);
app.use('/api/admin/disputes', adminDisputeRoutes);
app.use('/api/admin/verifications', adminVerificationRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/admin/pricing-rules', adminPricingRuleRoutes);
app.use('/api/admin/service-types', adminServiceTypeRoutes);
app.use('/api/admin/audit-logs', adminAuditLogRoutes);
app.use('/api/admin/reports', adminReportsRoutes);
app.use('/api/admin/settings', adminSettingsRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'OK' });
});

// Error handling
app.use(errorHandler);

export default app;
