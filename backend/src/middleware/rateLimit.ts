import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { rateLimitStore } from '@middleware/rateLimitStore';

const disabled = process.env.RATE_LIMIT_DISABLED === 'true';

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const passthrough: RequestHandler = (_req, _res, next) => next();

const WEBHOOK_PATHS = ['/payments/xendit/invoice-webhook', '/payments/xendit/payout-webhook'];

export const apiLimiter: RequestHandler = disabled
  ? passthrough
  : rateLimit({
      windowMs: num('RATE_LIMIT_API_WINDOW_MS', 60_000),
      limit: num('RATE_LIMIT_API_MAX', 300),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => WEBHOOK_PATHS.some((p) => req.path.startsWith(p)),
      message: { error: 'Too many requests, please slow down.' },
      store: rateLimitStore('rl:api:'),
    });

export const authLimiter: RequestHandler = disabled
  ? passthrough
  : rateLimit({
      windowMs: num('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60_000),
      limit: num('RATE_LIMIT_AUTH_MAX', 25),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: { error: 'Too many attempts. Try again later.' },
      store: rateLimitStore('rl:auth:'),
    });
