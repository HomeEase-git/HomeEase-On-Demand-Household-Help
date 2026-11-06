import prisma from '@config/database';

const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION = {
  expiredTokenDays: 1,
  readNotificationDays: 180,
  anyNotificationDays: 365,
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

  const [{ purged }] = await prisma.$queryRaw<[{ purged: number }]>`SELECT purge_expired_login_audit() AS purged`;

  const result = { expiredTokens: tokens.count, notifications: notifications.count, loginAuditEntries: purged };
  if (result.expiredTokens + result.notifications + result.loginAuditEntries > 0) {
    console.log('Data retention purge:', result);
  }
  return result;
}
