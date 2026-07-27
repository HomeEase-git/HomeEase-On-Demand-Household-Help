import prisma from '@config/database';
import { TokenType } from '@prisma/client';
import crypto from 'crypto';

const OTP_EXPIRY_MINUTES = 10;
const RESET_TOKEN_EXPIRY_HOURS = 24;

export const generateOtp = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const generateResetToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

export const storeOtp = async (userId: string, otp: string): Promise<void> => {
  // Invalidate any existing OTPs for this user
  await prisma.authToken.deleteMany({
    where: {
      userId,
      type: TokenType.EMAIL_VERIFICATION,
    },
  });

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

  await prisma.authToken.create({
    data: {
      userId,
      token: otp,
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt,
    },
  });
};

export const verifyOtp = async (userId: string, otp: string): Promise<boolean> => {
  const record = await prisma.authToken.findFirst({
    where: {
      userId,
      token: otp,
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  if (!record) return false;

  // Delete used OTP
  await prisma.authToken.delete({
    where: { id: record.id },
  });

  return true;
};

export const storePasswordResetToken = async (userId: string, token: string): Promise<void> => {
  // Invalidate any existing reset tokens for this user
  await prisma.authToken.deleteMany({
    where: {
      userId,
      type: TokenType.PASSWORD_RESET,
    },
  });

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);

  await prisma.authToken.create({
    data: {
      userId,
      token,
      type: TokenType.PASSWORD_RESET,
      expiresAt,
    },
  });
};

export const verifyPasswordResetToken = async (userId: string, token: string): Promise<boolean> => {
  const record = await prisma.authToken.findFirst({
    where: {
      userId,
      token,
      type: TokenType.PASSWORD_RESET,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  if (!record) return false;

  await prisma.authToken.delete({
    where: { id: record.id },
  });

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