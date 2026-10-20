import crypto from 'crypto';
import { keyedHash, keyedHashCandidates } from '@utils/fieldEncryption';
import prisma from '@config/database';
import { TokenType } from '@prisma/client';
import type { Response } from 'express';
import * as otpLimiter from '@utils/otpAttemptLimiter';
import { isOtpAttemptLocked, recordFailedOtpAttempt, clearOtpAttempts } from '@utils/otpAttemptLimiter';
import { errorResponse } from '@utils/errorResponse';

const OTP_EXPIRY_MINUTES = 10;

/**
 * Thrown when a user has entered too many wrong codes: no code can be checked
 * or re-sent until the lockout ends (see utils/otpAttemptLimiter.ts).
 */
export class OtpLockedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super('Too many wrong codes');
    this.name = 'OtpLockedError';
  }
}

async function lockSecondsLeft(userId: string, type: TokenType): Promise<number> {
  // Guarded: the limiter is replaced by a partial stub in some test suites.
  const remaining = await otpLimiter.otpLockRemainingSeconds?.(userId, type);
  return remaining && remaining > 0 ? remaining : (otpLimiter.OTP_LOCKOUT_SECONDS ?? 600);
}

/**
 * Replies 429 "try again in N minutes" when `error` is an OtpLockedError.
 * Returns true if it responded, so a catch block can `return` early.
 */
export function respondIfOtpLocked(res: Response, error: unknown): boolean {
  if (!(error instanceof OtpLockedError)) return false;
  const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
  res.setHeader('Retry-After', String(error.retryAfterSeconds));
  res.status(429).json({
    ...errorResponse(
      429,
      `Too many wrong codes. For your security you can't enter or request a new code for ${minutes} minute${minutes === 1 ? '' : 's'}.`
    ),
    code: 'OTP_LOCKED',
    retryAfterSeconds: error.retryAfterSeconds,
  });
  return true;
}

// Codes are stored as a keyed hash (DATA_ENCRYPTION_KEY), so a database copy
// can't be used, or brute-forced, to sign in or confirm an account action.
// The user and type are part of it: AuthToken.token is unique across all
// users, and two people can be sent the same six digits.
const otpMaterial = (userId: string, type: TokenType, otp: string): string => `${userId}:${type}:${otp}`;

export const generateOtp = (): string => {
  // CSPRNG — Math.random() output is predictable enough to guess codes.
  return crypto.randomInt(100000, 1000000).toString();
};

export const storeOtp = async (
  userId: string,
  otp: string,
  type: TokenType = TokenType.EMAIL_VERIFICATION,
): Promise<void> => {
  // A locked user can't get a fresh code to try again either: re-sending
  // doesn't reset the wrong-code counter, so the new code couldn't be used
  // until the lockout ends anyway — and would just flood their inbox.
  if (await isOtpAttemptLocked(userId, type)) {
    throw new OtpLockedError(await lockSecondsLeft(userId, type));
  }

  // Invalidate any existing OTPs of this type for this user
  await prisma.authToken.deleteMany({
    where: {
      userId,
      type,
    },
  });

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

  await prisma.authToken.create({
    data: {
      userId,
      token: await keyedHash('otp', otpMaterial(userId, type, otp)),
      type,
      expiresAt,
    },
  });
};

export const verifyOtp = async (
  userId: string,
  otp: string,
  type: TokenType = TokenType.EMAIL_VERIFICATION,
  // false = only check the code, leave it valid (and the attempt counter as is)
  // so the caller can still reject the request and let the user retry.
  { consume = true }: { consume?: boolean } = {},
): Promise<boolean> => {
  // Per-account brute-force guard, independent of the IP-keyed authLimiter
  // middleware — an attacker rotating IPs would otherwise get unlimited
  // guesses against a single account within the OTP's validity window.
  // See utils/otpAttemptLimiter.ts.
  if (await isOtpAttemptLocked(userId, type)) {
    throw new OtpLockedError(await lockSecondsLeft(userId, type));
  }

  const record = await prisma.authToken.findFirst({
    where: {
      userId,
      // ponytail: plaintext match only for codes issued before hashing
      // shipped (they expire within OTP_EXPIRY_MINUTES); drop it next
      // release. Six digits only, so a stored hash can't be replayed as a code.
      token: {
        in: [
          ...(await keyedHashCandidates('otp', otpMaterial(userId, type, otp))),
          ...(/^\d{6}$/.test(otp) ? [otp] : []),
        ],
      },
      type,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  if (!record) {
    const attempts = await recordFailedOtpAttempt(userId, type, OTP_EXPIRY_MINUTES * 60);
    // This was the wrong code that tripped the lockout: tell the user now.
    if (attempts >= otpLimiter.MAX_OTP_ATTEMPTS) {
      throw new OtpLockedError(otpLimiter.OTP_LOCKOUT_SECONDS ?? 600);
    }
    return false;
  }

  if (!consume) return true;

  // Delete used OTP
  await prisma.authToken.delete({
    where: { id: record.id },
  });

  await clearOtpAttempts(userId, type);

  return true;
};

// Refresh tokens are stored as a SHA-256 hash, so a database leak doesn't
// hand out live sessions. They're 40 random bytes, so an unsalted fast hash
// is enough (nothing to brute-force). Lookups match the hash only: accepting
// the raw value too (for rows from before hashing) let anyone who could read
// the table replay a stored hash as a live token. Pre-hashing rows simply no
// longer match; those users sign in again.
export const hashRefreshToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const refreshTokenLookup = (token: string) => hashRefreshToken(token);

// Two requests from the same device can race to refresh with the same token
// (e.g. two admin browser tabs). Within this window the loser just gets a 401
// and picks up the winner's new token; after it, a replay means the token was
// copied somewhere else.
export const REFRESH_REUSE_GRACE_MS = 30_000;

// How long rotated tokens are remembered for reuse detection. Bounds the rows
// a busy device leaves behind (one per access-token lifetime).
const USED_REFRESH_RETENTION_MS = 24 * 60 * 60 * 1000;

/** `expiresAt` defaults to 30 days (admin sessions pass a shorter one). */
export const storeRefreshToken = async (
  userId: string,
  token: string,
  sessionId?: string,
  expiresAt: Date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
): Promise<void> => {

  await prisma.authToken.create({
    data: {
      userId,
      token: hashRefreshToken(token),
      type: TokenType.REFRESH,
      expiresAt,
      sessionId: sessionId ?? null,
    },
  });
};

export type ConsumeRefreshResult =
  | { status: 'ok'; userId: string; sessionId: string | null }
  // Already rotated, outside the grace window: someone else holds a copy.
  | { status: 'reused'; userId: string; sessionId: string | null; tokenId: string }
  // Just rotated by a concurrent request (see REFRESH_REUSE_GRACE_MS).
  | { status: 'race' }
  | { status: 'invalid' };

/**
 * Spends a refresh token: marks it used (exactly once, even under concurrent
 * calls) and returns its owner and device. The caller issues the replacement.
 */
export const consumeRefreshToken = async (token: string): Promise<ConsumeRefreshResult> => {
  const now = new Date();
  const record = await prisma.authToken.findFirst({
    where: { token: refreshTokenLookup(token), type: TokenType.REFRESH },
  });

  if (!record || record.expiresAt <= now) return { status: 'invalid' };

  if (record.usedAt) {
    return now.getTime() - record.usedAt.getTime() < REFRESH_REUSE_GRACE_MS
      ? { status: 'race' }
      : { status: 'reused', userId: record.userId, sessionId: record.sessionId, tokenId: record.id };
  }

  const { count } = await prisma.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });
  // Lost a race with a concurrent refresh of the same token.
  if (count === 0) return { status: 'race' };

  if (record.sessionId) {
    await prisma.authToken.deleteMany({
      where: {
        type: TokenType.REFRESH,
        sessionId: record.sessionId,
        usedAt: { lt: new Date(now.getTime() - USED_REFRESH_RETENTION_MS) },
      },
    });
  }

  return { status: 'ok', userId: record.userId, sessionId: record.sessionId };
};

/**
 * Signs out the device a refresh token belongs to (all of its rotated
 * tokens too). Returns that device's session id, if it has one.
 */
export const revokeRefreshToken = async (token: string): Promise<string | null> => {
  const record = await prisma.authToken.findFirst({
    where: { token: refreshTokenLookup(token), type: TokenType.REFRESH },
    select: { id: true, sessionId: true },
  });
  if (!record) return null;

  await prisma.authToken.deleteMany({
    where: record.sessionId
      ? { type: TokenType.REFRESH, sessionId: record.sessionId }
      : { id: record.id },
  });
  return record.sessionId;
};

export const revokeAllRefreshTokens = async (userId: string): Promise<void> => {
  await prisma.authToken.deleteMany({
    where: {
      userId,
      type: TokenType.REFRESH,
    },
  });
};