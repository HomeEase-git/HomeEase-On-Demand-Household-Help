import prisma from '@config/database';
import { TokenType } from '@prisma/client';
import { isOtpAttemptLocked, recordFailedOtpAttempt, clearOtpAttempts } from '@utils/otpAttemptLimiter';

const OTP_EXPIRY_MINUTES = 10;

export const generateOtp = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
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

export const storeRefreshToken = async (userId: string, token: string): Promise<void> => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await prisma.authToken.create({
    data: {
      userId,
      token,
      type: TokenType.REFRESH,
      expiresAt,
    },
  });
};

export const verifyRefreshToken = async (token: string): Promise<string | null> => {
  const record = await prisma.authToken.findFirst({
    where: {
      token,
      type: TokenType.REFRESH,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  if (!record) return null;

  return record.userId;
};

export const revokeRefreshToken = async (token: string): Promise<void> => {
  await prisma.authToken.deleteMany({
    where: {
      token,
      type: TokenType.REFRESH,
    },
  });
};

export const revokeAllRefreshTokens = async (userId: string): Promise<void> => {
  await prisma.authToken.deleteMany({
    where: {
      userId,
      type: TokenType.REFRESH,
    },
  });
};