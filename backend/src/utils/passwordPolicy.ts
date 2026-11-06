import crypto from 'crypto';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_RULES_MESSAGE =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters with 1 uppercase letter and 1 number`;

export const BREACHED_PASSWORD_MESSAGE =
  'This password is commonly used or has been leaked online. Please choose a different one.';

const BREACH_CHECK_TIMEOUT_MS = 3000;

export const meetsPasswordRules = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH &&
  Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES &&
  /[A-Z]/.test(password) &&
  /\d/.test(password);

export async function isPasswordBreached(password: string): Promise<boolean> {
  if (process.env.PASSWORD_BREACH_CHECK === 'false') return false;

  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'HomeEase-password-check' },
      signal: AbortSignal.timeout(BREACH_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = await response.text();
    return body.split('\n').some((line) => {
      const [hashSuffix, count] = line.trim().split(':');
      // Padding entries have a count of 0.
      return hashSuffix === suffix && Number(count) > 0;
    });
  } catch (error) {
    console.warn('Breached-password check unavailable, skipping:', (error as Error)?.message ?? error);
    return false;
  }
}

export const PERSONAL_INFO_PASSWORD_MESSAGE =
  "Your password can't contain your name, email or phone number. Please choose a different one.";

const COMMON_PASSWORD_STEMS = new Set([
  'password', 'passwords', 'qwerty', 'qwertyuiop', 'qwertyuiopasdfghjkl', 'asdfghjkl', 'zxcvbnm',
  'welcome', 'letmein', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'basketball',
  'master', 'login', 'princess', 'sunshine', 'trustno', 'whatever', 'shadow', 'superman',
  'batman', 'michael', 'charlie', 'jordan', 'hello', 'freedom', 'secret', 'abc', 'abcdef',
  'abcdefg', 'abcdefgh', 'administrator', 'admin', 'root', 'changeme', 'default', 'guest',
  'homeease', 'philippines', 'pilipinas', 'manila', 'pinoy', 'pinay', 'mahalkita', 'iloveyoupo',
  'maganda', 'kumusta', 'marikina', 'cebu', 'davao', 'test', 'testing', 'testpassword',
]);

function commonStem(password: string): string {
  const isLetterOrLookalike = (ch: string) => (ch >= 'a' && ch <= 'z') || ch === '@' || ch === '$';
  const lowered = password.toLowerCase();
  let start = 0;
  let end = lowered.length;
  while (start < end && !isLetterOrLookalike(lowered[start])) start++;
  while (end > start && !isLetterOrLookalike(lowered[end - 1])) end--;

  return lowered
    .slice(start, end)
    .replace(/[@4]/g, 'a')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/[$5]/g, 's')
    .replace(/[^a-z]/g, '');
}

export const isCommonPassword = (password: string): boolean => COMMON_PASSWORD_STEMS.has(commonStem(password));

export interface PasswordPersonalInfo {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
}

const MIN_PERSONAL_TOKEN_LENGTH = 5;
const MIN_PHONE_DIGITS = 7;

function withoutTrailingDigits(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] >= '0' && value[end - 1] <= '9') end--;
  return value.slice(0, end);
}

export function containsPersonalInfo(password: string, info: PasswordPersonalInfo): boolean {
  const lowered = password.toLowerCase();
  const nameParts = (info.fullName ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const emailParts = (info.email ?? '').toLowerCase().split('@')[0].split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = [
    ...nameParts,
    nameParts.join(''),
    ...emailParts,
    emailParts.join(''),
  ]
    // "delacruz88" should also catch "delacruz2025".
    .flatMap((t) => [t, withoutTrailingDigits(t)])
    .filter((t) => t.length >= MIN_PERSONAL_TOKEN_LENGTH);
  if (tokens.some((t) => lowered.includes(t))) return true;

  const phoneDigits = (info.phone ?? '').replace(/\D/g, '');
  const passwordDigits = password.replace(/\D/g, '');
  if (phoneDigits.length >= MIN_PHONE_DIGITS) {
    return passwordDigits.includes(phoneDigits.slice(-MIN_PHONE_DIGITS));
  }
  return false;
}

export async function checkNewPassword(password: string, personalInfo?: PasswordPersonalInfo): Promise<string | null> {
  if (!meetsPasswordRules(password)) {
    return Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES
      ? `Password must be at most ${PASSWORD_MAX_BYTES} characters`
      : PASSWORD_RULES_MESSAGE;
  }
  if (isCommonPassword(password)) return BREACHED_PASSWORD_MESSAGE;
  if (personalInfo && containsPersonalInfo(password, personalInfo)) return PERSONAL_INFO_PASSWORD_MESSAGE;
  if (await isPasswordBreached(password)) return BREACHED_PASSWORD_MESSAGE;
  return null;
}
