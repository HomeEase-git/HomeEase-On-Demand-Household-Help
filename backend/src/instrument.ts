import * as Sentry from '@sentry/node';
import { installStructuredConsole, wantsStructuredLogging } from './utils/structuredConsole';
import { getRequestContext } from './utils/requestContext';
import { redactString } from './utils/logRedaction';

if (wantsStructuredLogging()) installStructuredConsole();

const SECRET_HEADERS = ['authorization', 'cookie', 'x-callback-token', 'x-cron-secret'];

const IGNORED_MESSAGES = [/Redis connection error/i, /ECONNREFUSED .*:6379/];

export function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  if (breadcrumb.data && typeof breadcrumb.data.url === 'string') {
    breadcrumb.data = { ...breadcrumb.data, url: breadcrumb.data.url.split('?')[0] };
  }
  return breadcrumb;
}

export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T | null {
  const text = [event.message, ...(event.exception?.values ?? []).map((v) => v.value)].join(' ');
  if (IGNORED_MESSAGES.some((re) => re.test(text))) return null;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split('?')[0];
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (SECRET_HEADERS.includes(name.toLowerCase())) delete event.request.headers[name];
      }
    }
  }
  if (event.extra) delete event.extra.arguments;
  delete event.user;
  if (event.message) event.message = redactString(event.message);
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redactString(value.value);
  }
  const requestId = getRequestContext()?.requestId;
  if (requestId) event.tags = { ...event.tags, request_id: requestId };
  return event;
}

export const sentryEnabled = Boolean(process.env.SENTRY_DSN);

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || undefined,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      httpHeaders: { request: { deny: SECRET_HEADERS }, response: false },
    },
    tracesSampleRate: 0, // errors only — keeps within the free plan
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (sentryEnabled) await Sentry.flush(timeoutMs);
}
