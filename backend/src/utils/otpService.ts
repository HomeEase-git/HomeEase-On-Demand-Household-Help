import crypto from 'crypto';
import prisma from '@config/database';
import { TokenType } from '@prisma/client';
import { isOtpAttemptLocked, recordFailedOtpAttempt, clearOtpAttempts } from '@utils/otpAttemptLimiter';

const OTP_EXPIRY_MINUTES = 10;

export const generateOtp = (): string => {
  // CSPRNG — Math.random() output is predictable enough to guess codes.
  return crypto.randomInt(100000, 1000000).toString();
};

export const storeOtp = async (
  userId: string,
  otp: string,
  type: TokenType = TokenType.EMAIL_VERIFICATION,
): Promise<void> => {
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
      token: otp,
      type,
      expiresAt,
    },
  });
};

export const verifyOtp = async (
  userId: string,
  otp: string,
  type: TokenType = TokenType.EMAIL_VERIFICATION,
): Promise<boolean> => {
  // Per-account brute-force guard, independent of the IP-keyed authLimiter
  // middleware — an attacker rotating IPs would otherwise get unlimited
  // guesses against a single account within the OTP's validity window.
  // See utils/otpAttemptLimiter.ts.
  if (await isOtpAttemptLocked(userId, type)) {
    return false;
  }

  const record = await prisma.authToken.findFirst({
    where: {
      userId,
      token: otp,
      type,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  if (!record) {
    await recordFailedOtpAttempt(userId, type, OTP_EXPIRY_MINUTES * 60);
    return false;
  }

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