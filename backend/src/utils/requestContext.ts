import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { setLogContextProvider, structuredLoggingEnabled, writeLogLine } from './structuredConsole';
import { redactString } from './logRedaction';

export interface RequestContext {
  requestId: string;
  upstreamRequestId?: string;
  ip?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();
setLogContextProvider(() => storage.getStore());

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

const INCOMING_ID = /^[\w-]{8,64}$/;

const QUIET_PATHS = new Set(['/health', '/health/ready']);

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

export function setRequestUser(userId: string): void {
  const context = storage.getStore();
  if (context) context.userId = userId;
}
