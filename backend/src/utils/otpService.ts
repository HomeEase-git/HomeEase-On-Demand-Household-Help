import crypto from 'crypto';
import { keyedHash, keyedHashCandidates } from '@utils/fieldEncryption';
import prisma from '@config/database';
import { TokenType } from '@prisma/client';
import type { Response } from 'express';
import * as otpLimiter from '@utils/otpAttemptLimiter';
import { isOtpAttemptLocked, recordFailedOtpAttempt, clearOtpAttempts } from '@utils/otpAttemptLimiter';
import { errorResponse } from '@utils/errorResponse';

const OTP_EXPIRY_MINUTES = 10;

export class OtpLockedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super('Too many wrong codes');
    this.name = 'OtpLockedError';
  }
}

async function lockSecondsLeft(userId: string, type: TokenType): Promise<number> {
  const remaining = await otpLimiter.otpLockRemainingSeconds?.(userId, type);
  return remaining && remaining > 0 ? remaining : (otpLimiter.OTP_LOCKOUT_SECONDS ?? 600);
}

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

const otpMaterial = (userId: string, type: TokenType, otp: string): string => `${userId}:${type}:${otp}`;

export const generateOtp = (): string => {
  return crypto.randomInt(100000, 1000000).toString();
};

export const storeOtp = async (
  userId: string,
  otp: string,
  type: TokenType = TokenType.EMAIL_VERIFICATION,
): Promise<void> => {
  if (await isOtpAttemptLocked(userId, type)) {
    throw new OtpLockedError(await lockSecondsLeft(userId, type));
  }

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
  { consume = true }: { consume?: boolean } = {},
): Promise<boolean> => {
  if (await isOtpAttemptLocked(userId, type)) {
    throw new OtpLockedError(await lockSecondsLeft(userId, type));
  }

  const record = await prisma.authToken.findFirst({
    where: {
      userId,
      // ponytail: plaintext match only for codes issued before hashing
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

export const hashRefreshToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const refreshTokenLookup = (token: string) => hashRefreshToken(token);

export const REFRESH_REUSE_GRACE_MS = 30_000;

const USED_REFRESH_RETENTION_MS = 24 * 60 * 60 * 1000;

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
  | { status: 'reused'; userId: string; sessionId: string | null; tokenId: string }
  | { status: 'race' }
  | { status: 'invalid' };

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