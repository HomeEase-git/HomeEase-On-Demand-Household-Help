import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN

export const monitoringEnabled = Boolean(dsn)

if (monitoringEnabled) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
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
