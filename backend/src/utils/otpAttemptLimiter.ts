import Redis from 'ioredis';
import { redisConnection } from '@config/redis';

// Per-account OTP brute-force guard. The only other protection on
// verifyOtp today is the IP-keyed `authLimiter` middleware — that stops
// nothing for an attacker who rotates IPs, since it has no memory of which
// *account* is being guessed against. This adds an independent,
// account-scoped attempt counter on top, keyed by userId + OTP type so a
// PASSWORD_RESET lockout doesn't also block EMAIL_VERIFICATION and vice
// versa.
//
// Deliberately Redis-only (no Prisma/schema field): the counter is
// inherently ephemeral (its TTL matches the OTP's own validity window —
// once the OTP expires, there's nothing left to brute-force and the
// counter should disappear with it), so a durable DB row would just be
// dead weight and, per this repo's current DB-migration caution, an
// avoidable migration.
//
// Mirrors utils/tokenRevocation.ts's connection pattern: a dedicated
// ioredis client (separate from the BullMQ queue/worker connections in
// config/redis.ts), lazyConnect + a bounded retryStrategy so a doomed
// connection attempt (no Redis reachable, e.g. this backend's own test
// suite) fails fast instead of retrying forever and keeping the process
// alive, and a small circuit breaker so a Redis outage doesn't add a
// doomed-connection delay to every single OTP verification. Like that
// module, this one FAILS OPEN on a Redis error — an outage here degrades
// back to "IP limiter only", which is the status quo today, not a new
// hole.
const client = new Redis({
  ...redisConnection,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  commandTimeout: 1500,
  retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
});

let loggedConnectionError = false;
client.on('error', (err) => {
  if (!loggedConnectionError) {
    console.error('OTP-attempt-limiter Redis connection error (further errors suppressed until it recovers):', err.message);
    loggedConnectionError = true;
  }
});
client.on('connect', () => {
  loggedConnectionError = false;
});

const ATTEMPT_KEY_PREFIX = 'otp-attempts:';

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function circuitIsOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

function recordFailure(context: string, error: unknown): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && circuitOpenUntil < Date.now()) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.error(
      `OTP-attempt-limiter Redis unreachable after ${consecutiveFailures} failures — skipping it for ${CIRCUIT_COOLDOWN_MS / 1000}s (last call: ${context}):`,
      (error as any)?.message ?? error
    );
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function attemptKey(userId: string, type: string): string {
  return `${ATTEMPT_KEY_PREFIX}${userId}:${type}`;
}

/**
 * How many wrong OTPs are tolerated for a given userId+type before further
 * attempts are locked out for the rest of the counter's TTL window.
 */
export const MAX_OTP_ATTEMPTS = 5;

/**
 * True if this userId+type has already hit MAX_OTP_ATTEMPTS wrong guesses
 * within the current window. Fails open (returns false) on a Redis error
 * or while the circuit breaker is open.
 */
export async function isOtpAttemptLocked(userId: string, type: string): Promise<boolean> {
  if (circuitIsOpen()) return false;
  try {
    const raw = await client.get(attemptKey(userId, type));
    recordSuccess();
    return raw !== null && Number(raw) >= MAX_OTP_ATTEMPTS;
  } catch (error) {
    recordFailure('isOtpAttemptLocked', error);
    return false;
  }
}

/**
 * Records one failed OTP attempt for this userId+type. `ttlSeconds` should
 * match the OTP's own validity window (OTP_EXPIRY_MINUTES in
 * otpService.ts) — the counter is only ever refreshed on the *first*
 * failure in a window (INCR then EXPIRE NX-style via a check on the
 * post-increment value), so it always expires at "OTP window from the
 * first wrong guess", not sliding forward on every retry.
 */
export async function recordFailedOtpAttempt(userId: string, type: string, ttlSeconds: number): Promise<void> {
  if (circuitIsOpen()) return;
  try {
    const key = attemptKey(userId, type);
    const attempts = await client.incr(key);
    if (attempts === 1) {
      await client.expire(key, ttlSeconds);
    }
    recordSuccess();
  } catch (error) {
    recordFailure('recordFailedOtpAttempt', error);
  }
}

/** Clears the counter on a successful OTP verification. */
export async function clearOtpAttempts(userId: string, type: string): Promise<void> {
  if (circuitIsOpen()) return;
  try {
    await client.del(attemptKey(userId, type));
    recordSuccess();
  } catch (error) {
    recordFailure('clearOtpAttempts', error);
  }
}
