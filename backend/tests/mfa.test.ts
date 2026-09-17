import request from 'supertest';
import { authenticator } from 'otplib';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

describe('Admin MFA', () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  // Full setup -> enable -> login-challenge -> backup-code lifecycle for one
  // admin, since each step depends on state the previous one created
  // (pending secret, then confirmed secret + backup codes, then a
  // challengeToken minted by a real login call).
  describe('setup, login challenge, and backup codes', () => {
    let adminId: string;
    let adminEmail: string;
    let adminPassword: string;
    let sessionToken: string;
    let totpSecret: string;
    let backupCodes: string[];

    beforeAll(async () => {
      const { user, plainPassword } = await createTestUser('mfa-admin', { role: 'ADMIN' });
      createdUserIds.push(user.id);
      adminId = user.id;
      adminEmail = user.email;
      adminPassword = plainPassword;

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });

      expect(login.status).toBe(200);
      // No MFA enrolled yet — the account still gets a normal session, but
      // flagged so the admin web app force-routes into setup once.
      expect(login.body.data.mfaSetupRequired).toBe(true);
      expect(login.body.data.token).toEqual(expect.any(String));
      sessionToken = login.body.data.token;
    });

    it('setup returns a provisioning secret and QR code without enabling MFA yet', async () => {
      const res = await request(app)
        .post('/api/auth/mfa/setup')
        .set('Authorization', `Bearer ${sessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.secret).toEqual(expect.any(String));
      expect(res.body.data.provisioningUri).toContain('otpauth://totp/');
      expect(res.body.data.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      totpSecret = res.body.data.secret;

      const stillEnabled = await prisma.user.findUnique({ where: { id: adminId } });
      expect(stillEnabled?.mfaEnabled).toBe(false);
    });

    it('verify-setup with a valid code enables MFA and returns backup codes once', async () => {
      const code = authenticator.generate(totpSecret);

      const res = await request(app)
        .post('/api/auth/mfa/verify-setup')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ code });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.backupCodes)).toBe(true);
      expect(res.body.data.backupCodes).toHaveLength(10);
      backupCodes = res.body.data.backupCodes;

      const updated = await prisma.user.findUnique({ where: { id: adminId } });
      expect(updated?.mfaEnabled).toBe(true);
    });

    it('login for an MFA-enabled admin returns mfaRequired, not a session token', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });

      expect(res.status).toBe(200);
      expect(res.body.data.mfaRequired).toBe(true);
      expect(res.body.data.challengeToken).toEqual(expect.any(String));
      expect(res.body.data.token).toBeUndefined();
    });

    it('challenge with the wrong code fails and is audit-logged', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });
      const challengeToken = login.body.data.challengeToken;

      const res = await request(app)
        .post('/api/auth/mfa/challenge')
        .send({ challengeToken, code: '000000' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { actorId: adminId, action: 'MFA_CHALLENGE_FAILED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditEntry).not.toBeNull();

      // authLimiter itself is disabled repo-wide for this suite (see
      // tests/setupEnv.ts — many requests from one loopback IP would
      // otherwise trip it and break unrelated assertions); the route wiring
      // that applies it to /mfa/challenge is exercised the same way every
      // other authLimiter route in this repo is: by being mounted, not by
      // asserting a live 429 here.
    });

    it('challenge with a correct TOTP code succeeds and issues a real session', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });
      const challengeToken = login.body.data.challengeToken;

      const code = authenticator.generate(totpSecret);
      const res = await request(app)
        .post('/api/auth/mfa/challenge')
        .send({ challengeToken, code });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.role).toBe('ADMIN');

      const auditEntry = await prisma.auditLog.findFirst({
        where: { actorId: adminId, action: 'MFA_CHALLENGE_SUCCESS' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditEntry).not.toBeNull();
    });

    it('a backup code works once, then is rejected on reuse', async () => {
      const backupCode = backupCodes[0];

      const firstLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });

      const firstChallenge = await request(app)
        .post('/api/auth/mfa/challenge')
        .send({ challengeToken: firstLogin.body.data.challengeToken, code: backupCode });

      expect(firstChallenge.status).toBe(200);
      expect(firstChallenge.body.data.token).toEqual(expect.any(String));

      const secondLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });

      const secondChallenge = await request(app)
        .post('/api/auth/mfa/challenge')
        .send({ challengeToken: secondLogin.body.data.challengeToken, code: backupCode });

      expect(secondChallenge.status).toBe(401);
    });
  });

  describe('CLIENT/WORKER login is unaffected by admin MFA', () => {
    it('never returns mfaRequired for a non-admin login', async () => {
      const { user, plainPassword } = await createTestUser('mfa-client', { role: 'CLIENT' });
      createdUserIds.push(user.id);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: plainPassword });

      expect(res.status).toBe(200);
      expect(res.body.data.mfaRequired).toBeUndefined();
      expect(res.body.data.mfaSetupRequired).toBeUndefined();
      expect(res.body.data.token).toEqual(expect.any(String));
    });
  });
});
