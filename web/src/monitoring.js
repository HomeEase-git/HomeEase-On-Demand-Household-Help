import * as Sentry from '@sentry/react'

// Error monitoring for the admin site. Off unless VITE_SENTRY_DSN is set at
// build time (Vercel env var), so local runs never report. Sends errors only:
// no session replay, no performance tracing, no request bodies, cookies or
// query strings — admin pages show TINs, payout details and IDs.
const dsn = import.meta.env.VITE_SENTRY_DSN

export const monitoringEnabled = Boolean(dsn)

if (monitoringEnabled) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    // Vercel exposes the commit through this build-time variable when set up.
    release: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0,
    dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console') return null
      if (breadcrumb.data && typeof breadcrumb.data.url === 'string') {
        breadcrumb.data = { ...breadcrumb.data, url: breadcrumb.data.url.split('?')[0] }
      }
      return breadcrumb
    },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data
        delete event.request.cookies
        delete event.request.query_string
        if (event.request.url) event.request.url = event.request.url.split('?')[0]
      }
      delete event.user
      return event
    },
  })
}

export { Sentry }
