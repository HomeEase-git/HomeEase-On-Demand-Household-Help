import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { setLogContextProvider, structuredLoggingEnabled, writeLogLine } from './structuredConsole';
import { redactString } from './logRedaction';

/**
 * Per-request context (request id, client IP, signed-in user) that follows
 * the request through every await, so log lines, error reports and security
 * alerts can say which request they came from without threading it through
 * every function.
 */
export interface RequestContext {
  /** Always generated here, so it's unique and can't be chosen by a caller. */
  requestId: string;
  /** An id set by a proxy in front of us, kept only to cross-reference its logs. */
  upstreamRequestId?: string;
  ip?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();
setLogContextProvider(() => storage.getStore());

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

// An incoming X-Request-Id is recorded (to match a proxy's logs) only if it
// looks like an id — never arbitrary header content — and never used as ours.
const INCOMING_ID = /^[\w-]{8,64}$/;

// Health probes (keep-alive every 5 minutes, uptime monitors) would drown the
// access log.
const QUIET_PATHS = new Set(['/health', '/health/ready']);

/**
 * First middleware: assigns the request id (echoed back as X-Request-Id, so a
 * user's error report can be matched to the logs) and writes one access-log
 * line per request when it finishes.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = crypto.randomUUID();
  const context: RequestContext = {
    requestId,
    ip: req.ip,
    ...(typeof incoming === 'string' && INCOMING_ID.test(incoming) ? { upstreamRequestId: incoming } : {}),
  };
  res.setHeader('X-Request-Id', requestId);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    if (QUIET_PATHS.has(req.path)) return;
    const status = res.statusCode;
    // No query string: it can carry tokens, emails and search terms.
    const path = req.originalUrl.split('?')[0];
    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    if (structuredLoggingEnabled()) {
      writeLogLine(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'request', {
        requestId,
        upstreamRequestId: context.upstreamRequestId,
        method: req.method,
        path,
        status,
        durationMs,
        ip: context.ip,
        userId: context.userId,
      });
    } else if (process.env.NODE_ENV === 'production') {
      // LOG_FORMAT=pretty: same line, plain text.
      process.stdout.write(
        `${new Date().toISOString()} ${req.method} ${redactString(path)} ${status} ${durationMs}ms req=${requestId}${context.userId ? ` user=${context.userId}` : ''}\n`,
      );
    }
  });

  storage.run(context, () => next());
}

/** Called by the auth middleware once the token is verified. */
export function setRequestUser(userId: string): void {
  const context = storage.getStore();
  if (context) context.userId = userId;
}
