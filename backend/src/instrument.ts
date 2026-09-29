import * as Sentry from '@sentry/node';

/**
 * Error monitoring. Loaded before anything else (see index.ts) so Sentry can
 * hook into Express, HTTP and Prisma as they load. Does nothing unless
 * SENTRY_DSN is set, so local runs and tests never report.
 *
 * What reaches Sentry: every console.error (the app's controllers log real
 * failures that way before answering 500), uncaught exceptions and unhandled
 * promise rejections. What never does: request bodies, cookies, auth or
 * webhook headers, query strings, user identities or console breadcrumbs —
 * those can carry TINs, payout numbers, phone numbers and tokens.
 */

const SECRET_HEADERS = ['authorization', 'cookie', 'x-callback-token', 'x-cron-secret'];

// Log lines that are expected operational noise, not bugs.
const IGNORED_MESSAGES = [/Redis connection error/i, /ECONNREFUSED .*:6379/];

/** Drops console breadcrumbs (they can hold personal data) and strips query strings from URLs. */
export function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  if (breadcrumb.data && typeof breadcrumb.data.url === 'string') {
    breadcrumb.data = { ...breadcrumb.data, url: breadcrumb.data.url.split('?')[0] };
  }
  return breadcrumb;
}

/** Last line of defence before an event leaves: no bodies, cookies, secrets or identities. */
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
  // console.error's arguments ride along as extra data — objects that can
  // carry request bodies (a JSON parse error holds the raw body) or records.
  // The error itself and its stack are still reported.
  if (event.extra) delete event.extra.arguments;
  delete event.user;
  return event;
}

export const sentryEnabled = Boolean(process.env.SENTRY_DSN);

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    // Render sets RENDER_GIT_COMMIT, so each error names the deploy it came from.
    release: process.env.RENDER_GIT_COMMIT || undefined,
    // Collect no personal data: no user identity, cookies, bodies or query
    // strings, and no secret headers (beforeSend below strips them again).
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
      // Report, then exit as Node would anyway, so Render restarts a clean process.
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
}

/** Sends anything still queued before the process exits. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (sentryEnabled) await Sentry.flush(timeoutMs);
}
