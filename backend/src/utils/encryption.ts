import crypto from 'crypto';

// AES-256-GCM helper for encrypting sensitive values at rest (currently:
// admin MFA/TOTP secrets — see utils/mfaService.ts). There was no existing
// encryption-at-rest pattern anywhere in the codebase to reuse (bank payout
// details are stored in plaintext today), so this is a new, narrowly-scoped
// helper rather than a general-purpose crypto module.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended IV length for GCM
const DEVELOPMENT_ENCRYPTION_KEY = 'homeease_development_mfa_key_change_me';

// The raw env var can be any length/format (hex, base64, plain text) — it's
// normalized to exactly 32 bytes via SHA-256 so callers never have to worry
// about generating a byte-perfect AES-256 key themselves.
const getEncryptionKey = (): Buffer => {
  const raw = process.env.MFA_ENCRYPTION_KEY?.trim();

  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MFA_ENCRYPTION_KEY is required in production');
    }
    return crypto.createHash('sha256').update(DEVELOPMENT_ENCRYPTION_KEY).digest();
  }

  return crypto.createHash('sha256').update(raw).digest();
};

/**
 * Encrypts a plaintext string, returning `iv:authTag:ciphertext` (all hex,
 * colon-separated) so the whole thing can be stored in a single text column.
 */
export const encrypt = (plaintext: string): string => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
};

/**
 * Reverses `encrypt`. Throws if the payload is malformed or the auth tag
 * doesn't verify (tampered ciphertext or wrong key).
 */
export const decrypt = (payload: string): string => {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
};
