import prisma from '@config/database';
import { TokenType } from '@prisma/client';

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

  if (!record) return false;

  // Delete used OTP
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