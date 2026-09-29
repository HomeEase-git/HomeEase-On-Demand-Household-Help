import prisma from '@config/database';
import { purgeExpiredData } from '@services/dataRetentionService';
import { createTestUser, deleteTestUser } from './helpers';
import { ownerDb } from './ownerDb';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const ACTION = 'RETENTION_TEST';

describe('purgeExpiredData', () => {
  let userId: string;

  // Audit rows can only be deleted by the owner (see tests/ownerDb.ts).
  const clearAuditRows = () => ownerDb.auditLog.deleteMany({ where: { action: ACTION } });

  beforeAll(async () => {
    const { user } = await createTestUser('retention', { role: 'CLIENT' });
    userId = user.id;
    await clearAuditRows();
  });

  afterAll(async () => {
    await deleteTestUser(userId);
    await clearAuditRows();
  });

  it('deletes tokens expired over a day ago and keeps the rest', async () => {
    const make = (token: string, expiresAt: Date) =>
      prisma.authToken.create({ data: { userId, token, type: 'PASSWORD_RESET', expiresAt } });
    const old = await make('retention-old', daysAgo(2));
    const recent = await make('retention-recent', new Date(Date.now() - 60 * 60 * 1000));
    const valid = await make('retention-valid', new Date(Date.now() + DAY_MS));

    await purgeExpiredData();

    const left = await prisma.authToken.findMany({ where: { id: { in: [old.id, recent.id, valid.id] } } });
    expect(left.map((t) => t.token).sort()).toEqual(['retention-recent', 'retention-valid']);
  });

  it('deletes notifications read over 180 days ago and any over a year old', async () => {
    const make = (title: string, isRead: boolean, createdAt: Date) =>
      prisma.notification.create({
        data: { userId, type: 'BOOKING_COMPLETED', title, message: 'retention test', isRead, createdAt },
      });
    await make('read-old', true, daysAgo(200));
    await make('read-recent', true, daysAgo(10));
    await make('unread-200d', false, daysAgo(200));
    await make('unread-400d', false, daysAgo(400));

    await purgeExpiredData();

    const left = await prisma.notification.findMany({ where: { userId }, select: { title: true } });
    expect(left.map((n) => n.title).sort()).toEqual(['read-recent', 'unread-200d']);
  });

  it('deletes sign-in audit entries over a year old, and no other audit entries', async () => {
    const make = (category: string, createdAt: Date) =>
      prisma.auditLog.create({ data: { action: ACTION, category, message: `${category} ${createdAt.toISOString()}`, createdAt } });
    await make('LOGIN', daysAgo(400));
    await make('LOGIN', daysAgo(300));
    await make('ADMIN_ACTION', daysAgo(400));
    await make('SECURITY', daysAgo(400));

    const result = await purgeExpiredData();

    const left = await prisma.auditLog.findMany({ where: { action: ACTION }, orderBy: { createdAt: 'asc' } });
    expect(left.map((a) => a.category).sort()).toEqual(['ADMIN_ACTION', 'LOGIN', 'SECURITY']);
    expect(left.find((a) => a.category === 'LOGIN')!.createdAt.getTime()).toBeGreaterThan(daysAgo(301).getTime());
    expect(result.loginAuditEntries).toBeGreaterThanOrEqual(1);
  });

  it('finds nothing to do on a second run', async () => {
    await purgeExpiredData();
    expect(await purgeExpiredData()).toEqual({ expiredTokens: 0, notifications: 0, loginAuditEntries: 0 });
  });
});
