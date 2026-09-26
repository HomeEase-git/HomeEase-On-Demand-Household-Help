import crypto from 'crypto';
import { decryptWithKey, deriveKey, encryptWithKey } from '@utils/encryption';

// Field-level encryption for worker payout account numbers and TINs
// (WorkerProfile.payoutAccountNumber/tin, Payout.accountNumber,
// TaxCertificate.workerTin). Encrypted values carry an `enc:v1:` prefix, so
// rows written before encryption existed (plaintext) still read correctly
// until scripts/encrypt-sensitive-fields.ts has backfilled them.
//
// Losing DATA_ENCRYPTION_KEY makes every encrypted value unrecoverable —
// keep it in a password manager, not only in the hosting dashboard.

const PREFIX = 'enc:v1:';
const DEVELOPMENT_KEY = 'homeease_development_data_key_change_me';

const getKey = (): Buffer => deriveKey('DATA_ENCRYPTION_KEY', DEVELOPMENT_KEY);

export function isEncryptedField(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Encrypts a value for storage. Already-encrypted input is returned as-is. */
export function encryptField(plaintext: string): string {
  if (isEncryptedField(plaintext)) return plaintext;
  return PREFIX + encryptWithKey(plaintext, getKey());
}

export function encryptOptionalField(plaintext: string | null | undefined): string | null | undefined {
  return plaintext ? encryptField(plaintext) : plaintext;
}

/** Decrypts a stored value; legacy plaintext is returned unchanged. */
export function decryptField(stored: string): string {
  if (!isEncryptedField(stored)) return stored;
  return decryptWithKey(stored.slice(PREFIX.length), getKey());
}

export function decryptOptionalField(stored: string | null | undefined): string | null | undefined {
  return stored ? decryptField(stored) : stored;
}

/**
 * Deterministic keyed hash of a normalized TIN. WorkerProfile.tinHash carries
 * the uniqueness constraint that the encrypted `tin` column can't (the same
 * TIN encrypts differently every time).
 */
export function hashTin(normalizedTin: string): string {
  return crypto.createHmac('sha256', getKey()).update(`tin:${normalizedTin}`).digest('hex');
}

/** "••••1234" — the last four digits/characters only. */
export function maskLastFour(value: string): string {
  const compact = value.replace(/[\s-]/g, '');
  return `••••${compact.slice(-4)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function containsEncrypted(value: unknown, depth: number): boolean {
  if (depth > 20) return false;
  if (isEncryptedField(value)) return true;
  if (Array.isArray(value)) return value.some((item) => containsEncrypted(item, depth + 1));
  if (isPlainObject(value)) return Object.values(value).some((item) => containsEncrypted(item, depth + 1));
  return false;
}

function maskDeep(value: unknown, depth: number): unknown {
  if (depth > 20) return value;
  if (isEncryptedField(value)) {
    try {
      return maskLastFour(decryptField(value));
    } catch {
      return '••••';
    }
  }
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, depth + 1));
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = maskDeep(item, depth + 1);
    return copy;
  }
  return value;
}

/**
 * Replaces every encrypted field value in `value` with its masked form, so
 * an endpoint returning a full WorkerProfile/Payout/TaxCertificate row never
 * leaks either ciphertext or the full number. Endpoints that legitimately
 * need the full number (the worker's own payout settings) decrypt explicitly.
 */
export function maskEncryptedFieldsDeep<T>(value: T): T {
  return containsEncrypted(value, 0) ? (maskDeep(value, 0) as T) : value;
}
