/**
 * Scrubs secrets and personal data out of anything headed for logs or error
 * reports. Two passes: values under sensitive-looking keys are replaced
 * wholesale, and every string is searched for credential shapes (tokens,
 * keys, passwords inside connection URLs, encrypted fields). Deliberately
 * over-eager — a masked value in a log costs nothing; a leaked one can't be
 * taken back.
 */

const REDACTED = '[REDACTED]';

// Key names whose values are never logged. `code` is deliberately absent —
// error codes (P2002, ECONNREFUSED) are what make logs useful.
const SENSITIVE_KEY =
  /password|passwd|token|secret|authorization|cookie|api_?key|^otp$|mfacode|backupcodes?|^tin$|workertin|accountnumber|x-callback-token|x-cron-secret/i;

const STRING_PATTERNS: Array<[RegExp, string]> = [
  // JSON Web Tokens (access, challenge, anything signed).
  [/eyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]{5,}/g, '[JWT]'],
  [/(Bearer\s+)[\w.~+/-]+=*/gi, `$1${REDACTED}`],
  // Passwords inside connection URLs: postgres://user:PASSWORD@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s]+@/gi, `$1${REDACTED}@`],
  // Provider keys.
  [/xnd_(?:production|development|public)_[\w]+/g, '[XENDIT_KEY]'],
  [/sk-ant-[\w-]{10,}/g, '[ANTHROPIC_KEY]'],
  [/xkeysib-[\w-]{10,}/g, '[BREVO_KEY]'],
  [/AIza[\w-]{35}/g, '[GOOGLE_KEY]'],
  // Field-encrypted values (payout numbers, TINs) — useless in a log anyway.
  [/enc:v\d+:[0-9a-f:]+/gi, '[ENCRYPTED]'],
  // Long hex runs: refresh tokens (80 hex), token hashes.
  [/\b[0-9a-f]{48,}\b/gi, '[HEX]'],
];

export function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of STRING_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

const MAX_DEPTH = 6;
const MAX_STRING = 4000;
const MAX_KEYS = 50;

/**
 * A JSON-safe, redacted copy of `value`: sensitive keys masked, strings
 * scrubbed and truncated, Errors flattened to name/message/code/stack,
 * circular references and deep nesting cut off.
 */
export function redactValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const clipped = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
    return redactString(clipped);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    if (depth >= MAX_DEPTH) return '[Object]';
    seen.add(value);

    if (value instanceof Error) {
      const err = value as Error & { code?: unknown; cause?: unknown };
      return {
        name: err.name,
        message: redactString(err.message ?? ''),
        ...(err.code !== undefined ? { code: redactValue(err.code, depth + 1, seen) } : {}),
        ...(err.stack ? { stack: redactString(err.stack) } : {}),
        ...(err.cause !== undefined ? { cause: redactValue(err.cause, depth + 1, seen) } : {}),
      };
    }

    if (Array.isArray(value)) {
      return value.slice(0, MAX_KEYS).map((item) => redactValue(item, depth + 1, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS)) {
      out[key] = SENSITIVE_KEY.test(key) && item !== null && item !== undefined && item !== ''
        ? REDACTED
        : redactValue(item, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}
