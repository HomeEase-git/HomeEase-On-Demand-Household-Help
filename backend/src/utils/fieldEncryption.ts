import crypto from 'crypto';
import { promisify } from 'util';
import { decryptWithKeyring, deriveKey, deriveKeyring, encryptWithKey } from '@utils/encryption';

const PREFIX = 'enc:v1:';
const DEVELOPMENT_KEY = 'homeease_development_data_key_change_me';

const getKey = (): Buffer => deriveKey('DATA_ENCRYPTION_KEY', DEVELOPMENT_KEY);
const getKeyring = (): Buffer[] => deriveKeyring('DATA_ENCRYPTION_KEY', DEVELOPMENT_KEY);

export function isEncryptedField(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptField(plaintext: string): string {
  if (isEncryptedField(plaintext)) return plaintext;
  return PREFIX + encryptWithKey(plaintext, getKey());
}

export function encryptOptionalField(plaintext: string | null | undefined): string | null | undefined {
  return plaintext ? encryptField(plaintext) : plaintext;
}

export function decryptField(stored: string): string {
  if (!isEncryptedField(stored)) return stored;
  return decryptWithKeyring(stored.slice(PREFIX.length), getKeyring()).plaintext;
}

export function isUnderPreviousDataKey(stored: string): boolean {
  if (!isEncryptedField(stored)) return false;
  return decryptWithKeyring(stored.slice(PREFIX.length), getKeyring()).keyIndex > 0;
}

export function decryptOptionalField(stored: string | null | undefined): string | null | undefined {
  return stored ? decryptField(stored) : stored;
}

const scryptAsync = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

async function deriveLookupHash(purpose: string, value: string, key: Buffer): Promise<string> {
  return (await scryptAsync(`${purpose}:${value}`, key, 32, { N: 16384, r: 8, p: 1 })).toString('hex');
}

export function keyedHash(purpose: string, value: string): Promise<string> {
  return deriveLookupHash(purpose, value, getKey());
}

export function keyedHashCandidates(purpose: string, value: string): Promise<string[]> {
  return Promise.all(getKeyring().map((key) => deriveLookupHash(purpose, value, key)));
}

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

export function maskEncryptedFieldsDeep<T>(value: T): T {
  return containsEncrypted(value, 0) ? (maskDeep(value, 0) as T) : value;
}
