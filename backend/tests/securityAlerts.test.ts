import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { sendAccountSecurityEmail, sendSecurityAlertEmail } from '@utils/emailService';
import { resetSecurityAlertThrottle, waitForSecurityAlerts } from '@services/securityAlertService';
import { MAX_LOGIN_ATTEMPTS } from '@utils/loginAttemptLimiter';
import { createTestUser, deleteTestUser } from './helpers';

jest.mock('@utils/emailService');

// In-memory stand-in for the Redis attempt counter (the suite has no Redis),
// with the real contract: recordFailedOtpAttempt returns the running count.
jest.mock('@utils/otpAttemptLimiter', () => {
  const counts = new Map<string, number>();
  const key = (id: string, type: string) => `${id}:${type}`;
  return {
    MAX_OTP_ATTEMPTS: 5,
    isOtpAttemptLocked: async (id: string, type: string, max = 5) => (counts.get(key(id, type)) ?? 0) >= max,
    recordFailedOtpAttempt: async (id: string, type: string) => {
      counts.set(key(id, type), (counts.get(key(id, type)) ?? 0) + 1);
      return counts.get(key(id, type));
    },
    clearOtpAttempts: async (id: string, type: string) => {
      counts.delete(key(id, type));
    },
  };
});

const alertEmail = sendSecurityAlertEmail as jest.MockedFunction<typeof sendSecurityAlertEmail>;
const userEmail = sendAccountSecurityEmail as jest.MockedFunction<typeof sendAccountSecurityEmail>;

const SECURITY_CONTACT = 'security-e2etest@homeease.invalid';

const securityLogs = (action: string) =>
  prisma.auditLog.findMany({ where: { category: 'SECURITY', action }, orderBy: { createdAt: 'asc' } });

describe('Security alerts', () => {
  const createdUserIds: string[] = [];
  const saved = { delivery: process.env.SECURITY_ALERT_TEST_DELIVERY, contact: process.env.SECURITY_ALERT_EMAIL };

  beforeAll(() => {
    process.env.SECURITY_ALERT_TEST_DELIVERY = 'true';
    process.env.SECURITY_ALERT_EMAIL = SECURITY_CONTACT;
  });

  beforeEach(async () => {
    alertEmail.mockReset().mockResolvedValue(undefined);
    userEmail.mockReset().mockResolvedValue(undefined);
    resetSecurityAlertThrottle();
    await prisma.auditLog.deleteMany({ where: { category: 'SECURITY' } });
  });

  afterAll(async () => {
    process.env.SECURITY_ALERT_TEST_DELIVERY = saved.delivery;
    process.env.SECURITY_ALERT_EMAIL = saved.contact;
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  async function signIn(label: string, role: 'CLIENT' | 'WORKER' | 'ADMIN' = 'CLIENT') {
    const { user, plainPassword } = await createTestUser(label, { role });
    createdUserIds.push(user.id);
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
    expect(res.status).toBe(200);
    return { user, plainPassword, token: res.body.data.token as string };
  }

  it('alerts when a client or worker token probes an admin endpoint, once per window', async () => {
    const { user, token } = await signIn('probe');
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/api/admin/audit-logs').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
    await waitForSecurityAlerts();

    const logs = await securityLogs('ADMIN_ROUTE_DENIED');
    expect(logs).toHaveLength(3); // every attempt is on record…
    expect(logs[0].actorId).toBe(user.id);
    expect(alertEmail).toHaveBeenCalledTimes(1); // …but only one email
    const [to, , summary, details] = alertEmail.mock.calls[0];
    expect(to).toBe(SECURITY_CONTACT);
    expect(summary).toContain('/api/admin/audit-logs');
    expect(details).toEqual(expect.arrayContaining([['Account', user.email]]));
  });

  it('attaches the request id to the alert and returns it to the caller', async () => {
    const { token } = await signIn('probe-id');
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Request-Id', 'trace-12345678');
    expect(res.headers['x-request-id']).toBe('trace-12345678');
    const [log] = await securityLogs('ADMIN_ROUTE_DENIED');
    expect((log.metadata as any).requestId).toBe('trace-12345678');
  });

  it('alerts on a forged Xendit webhook and a wrong cron secret', async () => {
    const webhook = await request(app)
      .post('/api/payments/xendit/invoice-webhook')
      .set('x-callback-token', 'forged')
      .send({ id: 'inv_fake', status: 'PAID' });
    expect(webhook.status).toBe(401);

    const cron = await request(app).post('/internal/cron/all').set('x-cron-secret', 'guess');
    expect(cron.status).toBe(401);
    await waitForSecurityAlerts();

    expect(await securityLogs('XENDIT_WEBHOOK_INVALID_TOKEN')).toHaveLength(1);
    expect(await securityLogs('CRON_SECRET_INVALID')).toHaveLength(1);
    expect(alertEmail).toHaveBeenCalledTimes(2);
  });

  it('raises a high-severity alert when an admin account is locked out', async () => {
    const { user } = await createTestUser('admin-lockout', { role: 'ADMIN' });
    createdUserIds.push(user.id);
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPassword123' });
    }
    await waitForSecurityAlerts();

    const [log] = await securityLogs('LOGIN_LOCKOUT');
    expect(log.level).toBe('ERROR');
    expect(log.actorId).toBe(user.id);
    expect(alertEmail).toHaveBeenCalledTimes(1);
    expect(alertEmail.mock.calls[0][1]).toMatch(/^Action needed/);
  });

  it('emails the user and audit-logs a password change', async () => {
    const { user, plainPassword, token } = await signIn('pw-change');
    const res = await request(app)
      .post('/api/users/me/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: plainPassword, newPassword: 'BrandNewPass2026' });
    expect(res.status).toBe(200);
    await waitForSecurityAlerts();

    expect(await securityLogs('PASSWORD_CHANGED')).toHaveLength(1);
    expect(userEmail).toHaveBeenCalledWith(user.email, 'Your HomeEase password was changed', expect.any(String));
    expect(alertEmail).not.toHaveBeenCalled(); // not an admin: no alert to the security contacts
  });

  it('still records alerts when an email fails to send', async () => {
    alertEmail.mockRejectedValue(new Error('Brevo down'));
    const { token } = await signIn('probe-email-down');
    const res = await request(app).get('/api/admin/audit-logs').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    await waitForSecurityAlerts();
    expect(await securityLogs('ADMIN_ROUTE_DENIED')).toHaveLength(1);
  });
});
