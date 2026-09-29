import { redactString, redactValue } from './logRedaction';
import type { RequestContext } from './requestContext';

/**
 * Production logging: every console.* call becomes one JSON line carrying the
 * request id and signed-in user, with secrets scrubbed (utils/logRedaction).
 * Render's log search can then filter on requestId, level or userId, and a
 * token or password that ends up in a log call never reaches the log store.
 *
 * Installed in instrument.ts BEFORE Sentry.init, so Sentry's console capture
 * wraps this: Sentry still receives the original Error objects (and scrubs
 * them itself), and the terminal output is the JSON line.
 *
 * Local development keeps normal console output unless LOG_FORMAT=json.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Set by requestContext.ts once it loads — a direct import would be circular
// (requestContext writes access-log lines through here).
let contextProvider: () => RequestContext | undefined = () => undefined;

export function setLogContextProvider(provider: () => RequestContext | undefined): void {
  contextProvider = provider;
}

let enabled = false;

export const structuredLoggingEnabled = (): boolean => enabled;

/** Writes one JSON log line directly (no console, so no Sentry capture). */
export function writeLogLine(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  if (!enabled) return;
  const context = contextProvider();
  const line = {
    time: new Date().toISOString(),
    level,
    msg: redactString(msg),
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.userId ? { userId: context.userId } : {}),
    ...(redactValue(fields) as Record<string, unknown>),
  };
  let json: string;
  try {
    json = JSON.stringify(line);
  } catch {
    json = JSON.stringify({ time: line.time, level, msg: line.msg, note: 'unserializable log fields dropped' });
  }
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${json}\n`);
}

/** Folds console.* arguments into a message plus structured fields. */
function toLine(args: unknown[]): { msg: string; fields: Record<string, unknown> } {
  const parts: string[] = [];
  const data: unknown[] = [];
  let err: unknown;
  for (const arg of args) {
    if (typeof arg === 'string') parts.push(arg);
    else if (typeof arg === 'number' || typeof arg === 'boolean') parts.push(String(arg));
    else if (arg instanceof Error && err === undefined) {
      err = arg;
      parts.push(arg.message);
    } else if (arg !== undefined) data.push(arg);
  }
  const fields: Record<string, unknown> = {};
  if (err !== undefined) fields.err = err;
  if (data.length === 1) fields.data = data[0];
  else if (data.length > 1) fields.data = data;
  return { msg: parts.join(' '), fields };
}

const METHODS: Array<[keyof Console, LogLevel]> = [
  ['debug', 'debug'],
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
];

/** Routes console.* through writeLogLine. Idempotent. */
export function installStructuredConsole(): void {
  if (enabled) return;
  enabled = true;
  for (const [method, level] of METHODS) {
    (console as unknown as Record<string, (...args: unknown[]) => void>)[method] = (...args: unknown[]) => {
      const { msg, fields } = toLine(args);
      writeLogLine(level, msg, fields);
    };
  }
}

/** Whether this process should log JSON: production, or LOG_FORMAT=json. */
export const wantsStructuredLogging = (): boolean =>
  process.env.LOG_FORMAT === 'json' || (process.env.NODE_ENV === 'production' && process.env.LOG_FORMAT !== 'pretty');
