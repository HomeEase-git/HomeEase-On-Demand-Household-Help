import prisma from '@config/database';

// Deletes data once nothing needs it any more (Data Privacy Act §11(e): kept
// no longer than necessary). The full schedule, including what is kept and
// why, is in docs/DATA-RESILIENCE.md; keep the two in sync.
//
// Runs daily from the booking queue and hourly from the /internal/cron
// backstop. Every rule is "older than X", so extra runs just find nothing.

const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION = {
  // Sign-in codes, reset links and refresh tokens are useless once expired.
  // A day's grace keeps "this code has expired" answers accurate for a
  // user who comes back to an old code.
  expiredTokenDays: 1,
  // Age from creation: there's no record of when a notification was read.
  readNotificationDays: 180,
  // Unread too: a notification nobody opened in a year won't be.
  anyNotificationDays: 365,
  // Sign-in entries (logins, failed logins, MFA) hold emails and names,
  // including of people who have no account. Fixed in the database function
  // purge_expired_login_audit() (migration 20260930000000_data_retention);
  // every other audit entry is kept.
  loginAuditDays: 365,
} as const;

export interface RetentionResult {
  expiredTokens: number;
  notifications: number;
  loginAuditEntries: number;
}

export async function purgeExpiredData(now: Date = new Date()): Promise<RetentionResult> {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const tokens = await prisma.authToken.deleteMany({
    where: { expiresAt: { lt: daysAgo(RETENTION.expiredTokenDays) } },
  });

  const notifications = await prisma.notification.deleteMany({
    where: {
      OR: [
        { isRead: true, createdAt: { lt: daysAgo(RETENTION.readNotificationDays) } },
        { createdAt: { lt: daysAgo(RETENTION.anyNotificationDays) } },
      ],
    },
  });

  // Not a Prisma deleteMany: the app's database role can't delete audit
  // rows (scripts/db-roles.ts); the function can, and only these.
  const [{ purged }] = await prisma.$queryRaw<[{ purged: number }]>`SELECT purge_expired_login_audit() AS purged`;

  const result = { expiredTokens: tokens.count, notifications: notifications.count, loginAuditEntries: purged };
  if (result.expiredTokens + result.notifications + result.loginAuditEntries > 0) {
    console.log('Data retention purge:', result);
  }
  return result;
}
