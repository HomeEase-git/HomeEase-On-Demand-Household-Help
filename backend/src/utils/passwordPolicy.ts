import crypto from 'crypto';

// Rules for any new password (sign-up, reset, change). Length does most of
// the work; the breach check rejects passwords already in public dumps,
// which is what credential stuffing actually uses (OWASP ASVS 6.1.2 / NIST
// 800-63B 3.1.1.2).

export const PASSWORD_MIN_LENGTH = 10;
// bcrypt ignores everything past 72 bytes — reject rather than silently
// truncate.
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_RULES_MESSAGE =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters with 1 uppercase letter and 1 number`;

export const BREACHED_PASSWORD_MESSAGE =
  'This password is too common or easy to guess. Please choose a different one.';

const BREACH_CHECK_TIMEOUT_MS = 3000;

export const meetsPasswordRules = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH &&
  Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES &&
  /[A-Z]/.test(password) &&
  /\d/.test(password);

/**
 * Have I Been Pwned range lookup (k-anonymity): only the first 5 hex chars
 * of the SHA-1 leave this server. Fails open — an outage there must not
 * block sign-ups. Off when PASSWORD_BREACH_CHECK=false (tests, offline dev).
 */
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

// The most common base words, matched after normalising (see commonStem). This
// is the offline fallback for when the breach lookup above is down.
const COMMON_PASSWORD_STEMS = new Set([
  'password', 'passwords', 'qwerty', 'qwertyuiop', 'qwertyuiopasdfghjkl', 'asdfghjkl', 'zxcvbnm',
  'welcome', 'letmein', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'basketball',
  'master', 'login', 'princess', 'sunshine', 'trustno', 'whatever', 'shadow', 'superman',
  'batman', 'michael', 'charlie', 'jordan', 'hello', 'freedom', 'secret', 'abc', 'abcdef',
  'abcdefg', 'abcdefgh', 'administrator', 'admin', 'root', 'changeme', 'default', 'guest',
  'homeease', 'philippines', 'pilipinas', 'manila', 'pinoy', 'pinay', 'mahalkita', 'iloveyoupo',
  'maganda', 'kumusta', 'marikina', 'cebu', 'davao', 'test', 'testing', 'testpassword',
]);

/**
 * "P@ssw0rd2024!" → "password": common look-alike characters are mapped back to
 * letters, then everything that isn't a letter is dropped.
 */
function commonStem(password: string): string {
  // Leading/trailing digits and symbols ("…2024!") go first so they aren't
  // mistaken for look-alike letters below. Trimmed with a loop rather than an
  // end-anchored regex, which backtracks badly on long untrusted input.
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

/** True when the password contains a real chunk of the person's own name, email or phone. */
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
    // Compare the last 7 digits so 0917… and +63917… both match.
    return passwordDigits.includes(phoneDigits.slice(-MIN_PHONE_DIGITS));
  }
  return false;
}

/** Error message for a new password, or null if it's acceptable. */
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
