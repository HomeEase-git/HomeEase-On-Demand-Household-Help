import type { ComponentType } from "react";
import * as Sentry from "@sentry/react-native";

// Crash and error reporting for the app. Off unless EXPO_PUBLIC_SENTRY_DSN is
// set for the build (EAS env), so dev builds and tests never report. Sends
// errors and crashes only: no screenshots, no performance tracing, no user
// identity, no console breadcrumbs, no query strings — the app handles IDs,
// TINs, payout numbers and addresses.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const monitoringEnabled = Boolean(dsn);

if (monitoringEnabled) {
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? (__DEV__ ? "development" : "production"),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === "console") return null;
      if (breadcrumb.data && typeof breadcrumb.data.url === "string") {
        breadcrumb.data = { ...breadcrumb.data, url: breadcrumb.data.url.split("?")[0] };
      }
      return breadcrumb;
    },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
      }
      delete event.user;
      return event;
    },
  });
}

/** Wraps the root component so crashes in any screen are reported. */
export function withMonitoring(Root: ComponentType<Record<string, unknown>>): ComponentType<Record<string, unknown>> {
  return monitoringEnabled ? Sentry.wrap(Root) : Root;
}
