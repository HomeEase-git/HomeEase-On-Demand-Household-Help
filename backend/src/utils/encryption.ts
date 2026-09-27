import crypto from 'crypto';

// AES-256-GCM helpers for encrypting sensitive values at rest. Two keys:
// MFA_ENCRYPTION_KEY for admin MFA/TOTP secrets (utils/mfaService.ts), and
// DATA_ENCRYPTION_KEY for worker payout account numbers and TINs
// (utils/fieldEncryption.ts). Separate keys so either can be rotated
// without touching the other.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended IV length for GCM
const DEVELOPMENT_ENCRYPTION_KEY = 'homeease_development_mfa_key_change_me';

// The raw env var can be any length/format (hex, base64, plain text) — it's
// normalized to exactly 32 bytes via SHA-256 so callers never have to worry
// about generating a byte-perfect AES-256 key themselves.
export const deriveKey = (envVar: string, developmentFallback: string): Buffer => {
  const raw = process.env[envVar]?.trim();

  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${envVar} is required in production`);
    }
    return crypto.createHash('sha256').update(developmentFallback).digest();
  }

  return crypto.createHash('sha256').update(raw).digest();
};

const getEncryptionKey = (): Buffer => deriveKey('MFA_ENCRYPTION_KEY', DEVELOPMENT_ENCRYPTION_KEY);

/**
 * Encrypts a plaintext string, returning `iv:authTag:ciphertext` (all hex,
 * colon-separated) so the whole thing can be stored in a single text column.
 */
export const encryptWithKey = (plaintext: string, key: Buffer): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
};

/**
 * Reverses `encryptWithKey`. Throws if the payload is malformed or the auth
 * tag doesn't verify (tampered ciphertext or wrong key).
 */
export const decryptWithKey = (payload: string, key: Buffer): string => {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
};

export const encrypt = (plaintext: string): string => encryptWithKey(plaintext, getEncryptionKey());

export const decrypt = (payload: string): string => decryptWithKey(payload, getEncryptionKey());
