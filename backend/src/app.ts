import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import prisma from '@config/database';
import { bookingQueue } from '@queues/bookingQueue';
import { apiLimiter } from '@middleware/rateLimit';
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
import adminTaxRoutes from '@routes/adminTax';
import internalCronRoutes from '@routes/internalCron';
import internalDiagRoutes from '@routes/internalDiag';
import { errorHandler } from '@middleware/errorHandler';

const app = express();
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '1mb';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Behind a load balancer / reverse proxy (Render, Railway, Fly, nginx, an
// ALB…) Express needs to trust X-Forwarded-* to see the real client IP and
// protocol — the rate limiter keys on IP, so getting this wrong either
// lets everyone share one bucket or lets clients spoof it. TRUST_PROXY is
// the number of proxy hops in front of the app (default 0 = direct).
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));

// Security headers. This is a JSON API (no first-party HTML), so CSP and
// the COEP/CORP embedding controls don't apply; the rest of helmet's
// defaults (HSTS, nosniff, frameguard, referrer-policy, …) do.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Middleware
app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonBodyLimit }));
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Liveness: is the process up? Cheap, no dependencies — this is what a
// container orchestrator / load balancer should poll.
app.get('/health', (_req, res) => {
  res.json({ status: 'OK' });
});

// Best-effort Redis reachability check via one of the existing BullMQ
// queues' own connection (no extra client/connection to manage). Bounded by
// a manual timeout on top of queueConnection's own bounded retries
// (@config/redis.ts) so this can never hang the health check indefinitely.
async function checkRedis(): Promise<boolean> {
  try {
    const client = await Promise.race([
      bookingQueue.client,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('redis check timed out')), 3000)),
    ]);
    // BullMQ's IRedisClient is adapter-agnostic (ioredis/node-redis/Bun) and
    // doesn't expose ping() — info() forces the same kind of live round-trip.
    await client.info();
    return true;
  } catch {
    return false;
  }
}

// Readiness: can the process actually serve traffic (DB reachable)?
// Returns 503 when not, so a rollout can wait for it and a broken pod is
// pulled from rotation. Redis is reported alongside but deliberately doesn't
// affect the status/HTTP code — per index.ts's uncaughtException guard, a
// Redis outage should degrade background job scheduling, not availability.
app.get('/health/ready', async (_req, res) => {
  const redisConnected = await checkRedis();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', redis: redisConnected ? 'connected' : 'unreachable' });
  } catch (error) {
    // Logged (not just swallowed) so the actual driver/DB error — auth,
    // TLS, DNS, timeout — shows up in the platform's log stream instead of
    // this endpoint's deliberately generic client-facing message.
    console.error('[health/ready] database check failed:', error);
    res.status(503).json({ status: 'not ready', reason: 'database unreachable', redis: redisConnected ? 'connected' : 'unreachable' });
  }
});

// Server-to-server sweep trigger for hosts that sleep on idle (see
// internalCron.ts) — deliberately outside /api so it's exempt from the
// broad API limiter and CORS allow-list; it has its own auth (CRON_SECRET)
// and its own limiter.
app.use('/internal/cron', internalCronRoutes);
app.use('/internal/diag', internalDiagRoutes);

// Broad rate limit across the whole API surface (credential endpoints get a
// second, stricter limiter inside routes/auth.ts).
app.use('/api', apiLimiter);

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
app.use('/api/admin/tax', adminTaxRoutes);

// Error handling
app.use(errorHandler);

export default app;
