import crypto from 'crypto';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import prisma from '@config/database';
import { encrypt, decrypt } from '@utils/encryption';
import { comparePassword } from '@utils/passwordHash';
import { isOtpAttemptLocked, recordFailedOtpAttempt, clearOtpAttempts, MAX_OTP_ATTEMPTS } from '@utils/otpAttemptLimiter';
import { raiseSecurityAlert } from '@services/securityAlertService';

authenticator.options = { window: 1 }; // ±30s clock-drift/typing-delay tolerance

const ISSUER = 'HomeEase';
const BACKUP_CODE_COUNT = 10;

export const generateMfaSecret = (): string => authenticator.generateSecret();

export const buildProvisioningUri = (email: string, secret: string): string =>
  authenticator.keyuri(email, ISSUER, secret);

export const generateQrCodeDataUrl = (provisioningUri: string): Promise<string> =>
  toDataURL(provisioningUri);

export const totpStep = (secret: string, code: string): number | null => {
  if (!/^\d{6}$/.test(code)) return null;
  try {
    const delta = authenticator.checkDelta(code, secret);
    return delta === null ? null : Math.floor(Date.now() / 30_000) + delta;
  } catch {
    return null;
  }
};

export const encryptMfaSecret = (secret: string): string => encrypt(secret);
export const decryptMfaSecret = (payload: string): string => decrypt(payload);

const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randomBackupCode = (): string => {
  let chars = '';
  for (let i = 0; i < 8; i++) {
    chars += BACKUP_CODE_ALPHABET[crypto.randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
};

export const generateBackupCodes = (count: number = BACKUP_CODE_COUNT): string[] =>
  Array.from({ length: count }, randomBackupCode);

const MFA_ATTEMPT_TYPE = 'MFA_CHALLENGE';
const MFA_ATTEMPT_TTL_SECONDS = 5 * 60;

export const verifyMfaCode = async (userId: string, code: string): Promise<boolean> => {
  if (await isOtpAttemptLocked(userId, MFA_ATTEMPT_TYPE)) {
    return false;
  }

  const trimmed = code.trim();
  let matched = false;

  if (trimmed) {
    const secretRecord = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (secretRecord && !secretRecord.pending) {
      const step = totpStep(decryptMfaSecret(secretRecord.secretEncrypted), trimmed);
      if (step !== null) {
        const claim = await prisma.mfaSecret.updateMany({
          where: { userId, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: step } }] },
          data: { lastTotpStep: step },
        });
        matched = claim.count === 1;
      }
    }

    if (!matched) {
      const normalizedBackupCode = trimmed.toUpperCase();
      const unusedCodes = await prisma.mfaBackupCode.findMany({ where: { userId, used: false } });
      for (const backupCode of unusedCodes) {
        if (await comparePassword(normalizedBackupCode, backupCode.codeHash)) {
          const claim = await prisma.mfaBackupCode.updateMany({
            where: { id: backupCode.id, used: false },
            data: { used: true, usedAt: new Date() },
          });
          matched = claim.count === 1;
          break;
        }
      }
    }
  }

  if (matched) {
    await clearOtpAttempts(userId, MFA_ATTEMPT_TYPE);
    return true;
  }

  const attempts = await recordFailedOtpAttempt(userId, MFA_ATTEMPT_TYPE, MFA_ATTEMPT_TTL_SECONDS);
  if (attempts === MAX_OTP_ATTEMPTS) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, role: true, fullName: true } });
    await raiseSecurityAlert({
      type: 'MFA_LOCKOUT',
      severity: 'high',
      message: `${user?.email ?? userId} entered ${MAX_OTP_ATTEMPTS} wrong two-step codes after a correct password — the password is probably known to someone else. Two-step sign-in is locked for a few minutes.`,
      actor: { id: userId, email: user?.email, role: user?.role, name: user?.fullName },
      throttleKey: userId,
    });
  }
  return false;
};
