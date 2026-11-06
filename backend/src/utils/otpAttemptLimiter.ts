import Redis from 'ioredis';
import { redisConnection } from '@config/redis';

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

// ponytail: per-process counter — covers the single Render instance; with
const localAttempts = new Map<string, { count: number; expiresAt: number }>();

function localCount(key: string): number {
  const entry = localAttempts.get(key);
  if (!entry) return 0;
  if (entry.expiresAt > Date.now()) return entry.count;
  localAttempts.delete(key);
  return 0;
}

function countLocally(key: string, ttlSeconds: number): number {
  const now = Date.now();
  if (localAttempts.size >= 10_000) {
    for (const [k, entry] of localAttempts) if (entry.expiresAt <= now) localAttempts.delete(k);
  }
  const count = localCount(key) + 1;
  let expiresAt = count === 1 ? now + ttlSeconds * 1000 : localAttempts.get(key)!.expiresAt;
  if (count === MAX_OTP_ATTEMPTS) expiresAt = now + OTP_LOCKOUT_SECONDS * 1000;
  localAttempts.set(key, { count, expiresAt });
  return count;
}

export const MAX_OTP_ATTEMPTS = 5;

export const OTP_LOCKOUT_SECONDS = 10 * 60;

export async function isOtpAttemptLocked(userId: string, type: string, maxAttempts: number = MAX_OTP_ATTEMPTS): Promise<boolean> {
  const lockedLocally = localCount(attemptKey(userId, type)) >= maxAttempts;
  if (circuitIsOpen()) return lockedLocally;
  try {
    const raw = await client.get(attemptKey(userId, type));
    recordSuccess();
    return raw !== null && Number(raw) >= maxAttempts;
  } catch (error) {
    recordFailure('isOtpAttemptLocked', error);
    return lockedLocally;
  }
}

export async function recordFailedOtpAttempt(userId: string, type: string, ttlSeconds: number): Promise<number> {
  const key = attemptKey(userId, type);
  const local = countLocally(key, ttlSeconds);
  if (circuitIsOpen()) return local;
  try {
    const attempts = await client.incr(key);
    if (attempts === 1) {
      await client.expire(key, ttlSeconds);
    }
    if (attempts === MAX_OTP_ATTEMPTS) {
      await client.expire(key, OTP_LOCKOUT_SECONDS);
    }
    recordSuccess();
    return attempts;
  } catch (error) {
    recordFailure('recordFailedOtpAttempt', error);
    return local;
  }
}

export async function otpLockRemainingSeconds(
  userId: string,
  type: string,
  maxAttempts: number = MAX_OTP_ATTEMPTS
): Promise<number> {
  const key = attemptKey(userId, type);
  const local = localAttempts.get(key);
  const localRemaining =
    local && local.count >= maxAttempts ? Math.max(0, Math.ceil((local.expiresAt - Date.now()) / 1000)) : 0;
  if (circuitIsOpen()) return localRemaining;
  try {
    const raw = await client.get(key);
    if (raw === null || Number(raw) < maxAttempts) {
      recordSuccess();
      return 0;
    }
    const ttl = await client.ttl(key);
    recordSuccess();
    return ttl > 0 ? ttl : OTP_LOCKOUT_SECONDS;
  } catch (error) {
    recordFailure('otpLockRemainingSeconds', error);
    return localRemaining;
  }
}

export async function clearOtpAttempts(userId: string, type: string): Promise<void> {
  localAttempts.delete(attemptKey(userId, type));
  if (circuitIsOpen()) return;
  try {
    await client.del(attemptKey(userId, type));
    recordSuccess();
  } catch (error) {
    recordFailure('clearOtpAttempts', error);
  }
}
