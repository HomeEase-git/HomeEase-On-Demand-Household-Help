import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { rateLimitStore } from '@middleware/rateLimitStore';

// Env knobs (all optional — the defaults below are sane for a single small
// instance behind one proxy). Set RATE_LIMIT_DISABLED=true to turn the
// whole thing off (e.g. for load tests).
const disabled = process.env.RATE_LIMIT_DISABLED === 'true';

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const passthrough: RequestHandler = (_req, _res, next) => next();

// Provider webhooks (Xendit) arrive from a small set of provider IPs and are
// already authenticated by a shared token. A retry storm must not get 429'd
// or payment confirmation stalls — exempt them from the broad IP limiter.
// Paths are relative to the `/api` mount point (see app.ts).
const WEBHOOK_PATHS = ['/payments/xendit/invoice-webhook', '/payments/xendit/payout-webhook'];

/**
 * Broad limiter for the whole /api surface — high enough that a normal
 * client (including a chatty admin dashboard) never trips it, low enough to
 * blunt scripted abuse. Keyed on client IP (see `trust proxy` in app.ts).
 */
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

/**
 * Strict limiter for unauthenticated credential endpoints (login, signup,
 * OTP, password reset) — the brute-force / enumeration targets, so the
 * ceiling is low and the window long. Only failed attempts count, so a
 * user legitimately logging in repeatedly is unaffected.
 *
 * The per-IP ceiling is a backstop only — the real brute-force guards are
 * account-scoped (utils/loginAttemptLimiter.ts, utils/otpAttemptLimiter.ts)
 * and an attacker rotating IPs walks straight past this one anyway. It is
 * set with room for one confused person on a shared IP: a mistyped OTP plus
 * a resend plus a retried sign-in is already ~6 failures, and 10 locked out
 * everyone behind that IP (CGNAT, office Wi-Fi) for 15 minutes.
 */
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
