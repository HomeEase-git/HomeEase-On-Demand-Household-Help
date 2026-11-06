import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended IV length for GCM
const DEVELOPMENT_ENCRYPTION_KEY = 'homeease_development_mfa_key_change_me';

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

export const deriveKeyring = (envVar: string, developmentFallback: string): Buffer[] => {
  const current = deriveKey(envVar, developmentFallback);
  const previous = process.env[`${envVar}_PREVIOUS`]?.trim();
  return previous ? [current, crypto.createHash('sha256').update(previous).digest()] : [current];
};

const getEncryptionKey = (): Buffer => deriveKey('MFA_ENCRYPTION_KEY', DEVELOPMENT_ENCRYPTION_KEY);
const getDecryptionKeys = (): Buffer[] => deriveKeyring('MFA_ENCRYPTION_KEY', DEVELOPMENT_ENCRYPTION_KEY);

export const encryptWithKey = (plaintext: string, key: Buffer): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
};

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

export const decryptWithKeyring = (payload: string, keys: Buffer[]): { plaintext: string; keyIndex: number } => {
  let lastError: unknown;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    try {
      return { plaintext: decryptWithKey(payload, keys[keyIndex]), keyIndex };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

export const encrypt = (plaintext: string): string => encryptWithKey(plaintext, getEncryptionKey());

export const decrypt = (payload: string): string => decryptWithKeyring(payload, getDecryptionKeys()).plaintext;

export const isUnderPreviousKey = (payload: string): boolean =>
  decryptWithKeyring(payload, getDecryptionKeys()).keyIndex > 0;
