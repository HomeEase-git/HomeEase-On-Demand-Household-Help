import * as Sentry from '@sentry/node';
import prisma from '@config/database';
import { writeAuditLog } from '@utils/auditLog';
import { sendAccountSecurityEmail, sendSecurityAlertEmail } from '@utils/emailService';
import { getRequestContext } from '@utils/requestContext';

/**
 * Security alerts: things that may mean an attack or a compromised account.
 * Every alert is written to the audit log (category SECURITY — admin site →
 * Reports → Logs → Security). The first of each kind in a 15-minute window is
 * also emailed to the security contacts and reported to Sentry; repeats inside
 * the window are counted and mentioned in the next email instead, so an
 * attack can't flood the inbox or use up the Sentry quota.
 *
 * Recipients: SECURITY_ALERT_EMAIL (comma-separated), or every active admin
 * if that's unset. What each alert means and what to do: docs/MONITORING.md.
 */

export type SecurityAlertType =
  | 'REFRESH_TOKEN_REUSE'
  | 'LOGIN_LOCKOUT'
  | 'MFA_LOCKOUT'
  | 'ADMIN_MFA_DISABLED'
  | 'ADMIN_PASSWORD_CHANGED'
  | 'ADMIN_ROUTE_DENIED'
  | 'XENDIT_WEBHOOK_INVALID_TOKEN'
  | 'XENDIT_PAYOUT_WEBHOOK_INVALID_TOKEN'
  | 'CRON_SECRET_INVALID';

export interface SecurityAlert {
  type: SecurityAlertType;
  /** high: likely a compromised account or credential. medium: probing or misconfiguration. */
  severity: 'high' | 'medium';
  /** One plain sentence; goes in the email and the audit log. */
  message: string;
  actor?: { id?: string | null; email?: string | null; role?: string | null; name?: string | null };
  /**
   * Alerts of one type share a throttle window per key: e.g. per account for
   * a lockout, so a second account locking out still sends its own email.
   */
  throttleKey?: string;
  metadata?: Record<string, unknown>;
}

const THROTTLE_MS = 15 * 60 * 1000;

// In-process: the backend runs as one instance. With several, each would send
// at most one email per window — still bounded.
const throttle = new Map<string, { until: number; suppressed: number }>();

const pending = new Set<Promise<void>>();

// Tests run without real email; they opt in and mock emailService.
const deliveryEnabled = (): boolean =>
  process.env.NODE_ENV !== 'test' || process.env.SECURITY_ALERT_TEST_DELIVERY === 'true';

/**
 * Waits for every in-flight alert — audit write, recipient lookup and emails —
 * including ones started while waiting (tests, graceful shutdown).
 */
export async function waitForSecurityAlerts(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

export function resetSecurityAlertThrottle(): void {
  throttle.clear();
}

async function alertRecipients(): Promise<string[]> {
  const configured = (process.env.SECURITY_ALERT_EMAIL ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE', isDeleted: false },
    select: { email: true },
  });
  return admins.map((admin) => admin.email);
}

/** Returns how many earlier alerts were suppressed, or null if this one is throttled. */
function passThrottle(key: string): number | null {
  const now = Date.now();
  const entry = throttle.get(key);
  if (entry && entry.until > now) {
    entry.suppressed += 1;
    return null;
  }
  const suppressed = entry?.suppressed ?? 0;
  throttle.set(key, { until: now + THROTTLE_MS, suppressed: 0 });
  return suppressed;
}

/**
 * Nobody was told: reopen the window so the next alert of this kind is sent,
 * and have it mention this one.
 */
function releaseThrottle(key: string, undelivered: number): void {
  const entry = throttle.get(key);
  if (entry) {
    entry.until = 0;
    entry.suppressed += undelivered;
  }
}

function track<T>(work: Promise<T>): Promise<T> {
  pending.add(work as Promise<unknown> as Promise<void>);
  void work.finally(() => pending.delete(work as Promise<unknown> as Promise<void>)).catch(() => undefined);
  return work;
}

/** Tracked so graceful shutdown waits for the whole alert, not just its email. */
export function raiseSecurityAlert(alert: SecurityAlert): Promise<void> {
  return track(raise(alert));
}

async function raise(alert: SecurityAlert): Promise<void> {
  const context = getRequestContext();
  const time = new Date();

  await writeAuditLog({
    actorId: alert.actor?.id ?? null,
    actorName: alert.actor?.name ?? null,
    actorRole: alert.actor?.role ?? null,
    action: alert.type,
    category: 'SECURITY',
    level: alert.severity === 'high' ? 'ERROR' : 'WARN',
    message: alert.message,
    metadata: {
      ...alert.metadata,
      severity: alert.severity,
      ...(alert.actor?.email ? { email: alert.actor.email } : {}),
      ...(context?.ip ? { ip: context.ip } : {}),
      ...(context?.requestId ? { requestId: context.requestId } : {}),
    },
  });
  console.warn(`Security alert ${alert.type}: ${alert.message}`);

  const throttleKey = `${alert.type}:${alert.throttleKey ?? ''}`;
  const suppressed = passThrottle(throttleKey);
  if (suppressed === null) return;

  Sentry.captureMessage(`Security: ${alert.type} — ${alert.message}`, {
    level: alert.severity === 'high' ? 'error' : 'warning',
    tags: { security_event: alert.type, severity: alert.severity },
    fingerprint: ['security-alert', alert.type],
  });

  if (!deliveryEnabled()) return;
  track(
    (async () => {
      const details: Array<[string, string]> = [
        ['Event', alert.type],
        ['Severity', alert.severity],
        ['Time (UTC)', time.toISOString()],
      ];
      if (alert.actor?.email) details.push(['Account', alert.actor.email]);
      if (alert.actor?.role) details.push(['Role', alert.actor.role]);
      if (alert.actor?.id) details.push(['User id', alert.actor.id]);
      if (context?.ip) details.push(['IP address', context.ip]);
      if (context?.requestId) details.push(['Request id', context.requestId]);
      if (suppressed > 0) details.push(['Also since last email', `${suppressed} more of this kind (see the audit log)`]);

      const subject = `${alert.severity === 'high' ? 'Action needed: ' : ''}${alert.type.replace(/_/g, ' ').toLowerCase()}`;
      const recipients = await alertRecipients();
      // Each recipient separately: one bad address mustn't stop the rest.
      const results = await Promise.allSettled(
        recipients.map((to) => sendSecurityAlertEmail(to, subject, alert.message, details)),
      );
      for (const result of results) {
        if (result.status === 'rejected') console.error('Security alert email failed:', result.reason);
      }
      if (!results.some((result) => result.status === 'fulfilled')) {
        if (recipients.length === 0) console.error('Security alert not emailed: no SECURITY_ALERT_EMAIL and no active admin');
        releaseThrottle(throttleKey, 1);
      }
    })().catch((error) => {
      console.error('Security alert email failed:', error);
      releaseThrottle(throttleKey, 1);
    }),
  );
}

/**
 * Emails a user about a security change on their own account (password
 * changed, a session ended because its token was copied). Best-effort and
 * not throttled — each is a single, user-triggered event.
 */
export function notifyAccountSecurityEvent(email: string, subject: string, message: string): void {
  if (!deliveryEnabled()) return;
  track(
    sendAccountSecurityEmail(email, subject, message).catch((error) =>
      console.error('Account security email failed:', error),
    ),
  );
}

/**
 * Audit-logs a password change or reset and emails the account owner, so a
 * takeover doesn't go unnoticed. An admin's change also alerts the security
 * contacts.
 */
export const recordPasswordChange = async (
  user: { id: string; email: string; role: string; fullName: string },
  how: 'changed' | 'reset',
): Promise<void> => {
  await writeAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    actorRole: user.role,
    action: how === 'reset' ? 'PASSWORD_RESET' : 'PASSWORD_CHANGED',
    category: 'SECURITY',
    message: `${user.fullName} ${how === 'reset' ? 'reset their password with an emailed code' : 'changed their password'}; other devices were signed out`,
  });
  if (user.role === 'ADMIN') {
    await raiseSecurityAlert({
      type: 'ADMIN_PASSWORD_CHANGED',
      severity: 'medium',
      message: `Admin ${user.email}'s password was ${how}.`,
      actor: { id: user.id, email: user.email, role: user.role, name: user.fullName },
      throttleKey: user.id,
    });
  }
  notifyAccountSecurityEvent(
    user.email,
    how === 'reset' ? 'Your HomeEase password was reset' : 'Your HomeEase password was changed',
    `Your password was ${how} on ${new Date().toUTCString()}, and your other devices were signed out.`,
  );
};
