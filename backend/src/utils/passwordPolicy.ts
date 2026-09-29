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
  'This password has appeared in a known data breach. Please choose a different one.';

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

/** Error message for a new password, or null if it's acceptable. */
export async function checkNewPassword(password: string): Promise<string | null> {
  if (!meetsPasswordRules(password)) {
    return Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES
      ? `Password must be at most ${PASSWORD_MAX_BYTES} characters`
      : PASSWORD_RULES_MESSAGE;
  }
  if (await isPasswordBreached(password)) return BREACHED_PASSWORD_MESSAGE;
  return null;
}
