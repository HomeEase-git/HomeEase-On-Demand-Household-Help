import crypto from 'crypto';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import prisma from '@config/database';
import { encrypt, decrypt } from '@utils/encryption';
import { comparePassword } from '@utils/passwordHash';
import { isOtpAttemptLocked, recordFailedOtpAttempt, clearOtpAttempts } from '@utils/otpAttemptLimiter';

// TOTP (RFC 6238) setup/verification for admin MFA — see
// controllers/authController.ts (mfaSetup/mfaVerifySetup/mfaChallenge/
// mfaDisable) for the HTTP surface. Uses otplib's defaults throughout
// (SHA-1, 6 digits, 30s period), which is what every mainstream
// authenticator app (Google Authenticator, Authy, 1Password, Microsoft
// Authenticator) assumes.
//
// Pinned to the otplib@12 line (the classic synchronous `authenticator`
// API) rather than the newer v13 rewrite: v13's default plugins
// (@otplib/plugin-crypto-noble, @otplib/plugin-base32-scure) are
// ESM-only, and this repo's Jest suite runs under ts-jest with no Babel/
// ESM transform configured — requiring v13 broke every existing test file
// that transitively imports authController (i.e. all of them) with
// "SyntaxError: Unexpected token 'export'" from deep inside
// @scure/base. v12 is still actively maintained (last publish matches
// v13's) and its default plugins are plain CommonJS (node's own `crypto`
// + a hex/base32 codec), so it has zero ESM-interop exposure.
authenticator.options = { window: 1 }; // ±30s clock-drift/typing-delay tolerance

const ISSUER = 'HomeEase Admin';
const BACKUP_CODE_COUNT = 10;

export const generateMfaSecret = (): string => authenticator.generateSecret();

export const buildProvisioningUri = (email: string, secret: string): string =>
  authenticator.keyuri(email, ISSUER, secret);

export const generateQrCodeDataUrl = (provisioningUri: string): Promise<string> =>
  toDataURL(provisioningUri);

export const verifyTotp = (secret: string, code: string): boolean => {
  if (!/^\d{6}$/.test(code)) return false;

  try {
    return authenticator.check(code, secret);
  } catch {
    // otplib throws on a malformed secret/token rather than returning
    // false — treat that the same as "doesn't match".
    return false;
  }
};

export const encryptMfaSecret = (secret: string): string => encrypt(secret);
export const decryptMfaSecret = (payload: string): string => decrypt(payload);

// Backup/recovery codes — an unambiguous alphabet (no 0/O/1/I) so a
// hand-copied code isn't a coin flip to transcribe correctly, formatted
// XXXX-XXXX for readability.
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

// Per-account brute-force guard on top of the IP-keyed authLimiter
// middleware — same rationale and same underlying Redis-backed counter as
// otpService.verifyOtp's OTP_ATTEMPT_TYPE guard (an attacker rotating IPs
// would otherwise get unlimited guesses against one admin account within
// the challenge token's validity window). Shared across both
// /mfa/challenge and /mfa/disable since both call verifyMfaCode.
const MFA_ATTEMPT_TYPE = 'MFA_CHALLENGE';
const MFA_ATTEMPT_TTL_SECONDS = 5 * 60;

/**
 * Verifies a 6-digit TOTP code OR an unused backup code for a user with a
 * confirmed (non-pending) MFA secret. A matching backup code is marked used
 * as a side effect (single-use). Returns false, touching nothing but the
 * attempt counter, if neither matches or the account is currently locked
 * out — callers are responsible for audit-logging the failure.
 */
export const verifyMfaCode = async (userId: string, code: string): Promise<boolean> => {
  if (await isOtpAttemptLocked(userId, MFA_ATTEMPT_TYPE)) {
    return false;
  }

  const trimmed = code.trim();
  let matched = false;

  if (trimmed) {
    const secretRecord = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (secretRecord && !secretRecord.pending) {
      const secret = decryptMfaSecret(secretRecord.secretEncrypted);
      if (verifyTotp(secret, trimmed)) {
        matched = true;
      }
    }

    if (!matched) {
      const normalizedBackupCode = trimmed.toUpperCase();
      const unusedCodes = await prisma.mfaBackupCode.findMany({ where: { userId, used: false } });
      for (const backupCode of unusedCodes) {
        if (await comparePassword(normalizedBackupCode, backupCode.codeHash)) {
          await prisma.mfaBackupCode.update({
            where: { id: backupCode.id },
            data: { used: true, usedAt: new Date() },
          });
          matched = true;
          break;
        }
      }
    }
  }

  if (matched) {
    await clearOtpAttempts(userId, MFA_ATTEMPT_TYPE);
    return true;
  }

  await recordFailedOtpAttempt(userId, MFA_ATTEMPT_TYPE, MFA_ATTEMPT_TTL_SECONDS);
  return false;
};
