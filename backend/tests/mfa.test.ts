import request from 'supertest';
import { authenticator } from 'otplib';
import app from '@/app';
import prisma from '@config/database';
import { sendOtpEmail } from '@utils/emailService';
import { createTestUser, deleteTestUser } from './helpers';

// Two-step sign-in codes go out by email; nothing is really sent in tests.
jest.mock('@utils/emailService', () => ({
  ...jest.requireActual('@utils/emailService'),
  sendOtpEmail: jest.fn().mockResolvedValue(undefined),
}));

/** The code the server just emailed (codes are stored hashed and single-use). */
async function latestCode(_userId: string, _type: 'LOGIN_2FA' | 'ACCOUNT_ACTION'): Promise<string> {
  const calls = jest.mocked(sendOtpEmail).mock.calls;
  return calls[calls.length - 1][1];
}

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

    it('refuses the same TOTP code a second time', async () => {
      const code = authenticator.generate(totpSecret);
      const login = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
      const res = await request(app)
        .post('/api/auth/mfa/challenge')
        .send({ challengeToken: login.body.data.challengeToken, code });

      // Either this exact code was just used above, or it's a fresh step and
      // this use spends it; a second use of it must fail either way.
      if (res.status === 200) {
        const again = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
        const replay = await request(app)
          .post('/api/auth/mfa/challenge')
          .send({ challengeToken: again.body.data.challengeToken, code });
        expect(replay.status).toBe(401);
      } else {
        expect(res.status).toBe(401);
      }
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

  describe('server-side admin MFA gate', () => {
    const previous = process.env.ADMIN_MFA_ENFORCEMENT;
    beforeAll(() => {
      process.env.ADMIN_MFA_ENFORCEMENT = 'on';
    });
    afterAll(() => {
      process.env.ADMIN_MFA_ENFORCEMENT = previous;
    });

    it('refuses admin-only routes to an admin session without MFA, but allows MFA setup', async () => {
      const { user, plainPassword } = await createTestUser('mfa-gate-admin', { role: 'ADMIN' });
      createdUserIds.push(user.id);
      const login = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
      expect(login.status).toBe(200);
      const token = login.body.data.token;

      const admin = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${token}`);
      expect(admin.status).toBe(403);
      expect(admin.body.code).toBe('ADMIN_MFA_REQUIRED');

      const setup = await request(app).post('/api/auth/mfa/setup').set('Authorization', `Bearer ${token}`);
      expect(setup.status).toBe(200);
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

  // Clients and workers use an email/SMS code instead of an authenticator
  // app (see routes/auth.ts /2fa). Opt-in; never forced.
  describe('Two-step sign-in for CLIENT/WORKER accounts', () => {
    it('no longer offers authenticator-app setup to a CLIENT', async () => {
      const { user, plainPassword } = await createTestUser('mfa-client-totp', { role: 'CLIENT' });
      createdUserIds.push(user.id);
      const login = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
      const setup = await request(app)
        .post('/api/auth/mfa/setup')
        .set('Authorization', `Bearer ${login.body.data.token}`);
      expect(setup.status).toBe(403);
    });

    it('lets a CLIENT turn on email codes, requires the code on the next login, and turn it off', async () => {
      const { user, plainPassword } = await createTestUser('twofa-client', { role: 'CLIENT' });
      createdUserIds.push(user.id);

      const firstLogin = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
      expect(firstLogin.status).toBe(200);
      expect(firstLogin.body.data.mfaSetupRequired).toBeUndefined();
      const sessionToken = firstLogin.body.data.token;

      const sent = await request(app)
        .post('/api/auth/2fa/code')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ method: 'EMAIL' });
      expect(sent.status).toBe(200);

      const wrong = await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ method: 'EMAIL', code: '000000' });
      expect(wrong.status).toBe(400);

      const enable = await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ method: 'EMAIL', code: await latestCode(user.id, 'ACCOUNT_ACTION') });
      expect(enable.status).toBe(200);

      const secondLogin = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
      expect(secondLogin.status).toBe(200);
      expect(secondLogin.body.data.twoFactorRequired).toBe(true);
      expect(secondLogin.body.data.token).toBeUndefined();
      const challengeToken = secondLogin.body.data.challengeToken;

      // The challenge token alone is not a session.
      const blocked = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${challengeToken}`);
      expect(blocked.status).toBe(401);

      const verified = await request(app)
        .post('/api/auth/2fa/verify')
        .send({ challengeToken, code: await latestCode(user.id, 'LOGIN_2FA') });
      expect(verified.status).toBe(200);
      expect(verified.body.data.role).toBe('CLIENT');
      expect(typeof verified.body.data.hasAcceptedTerms).toBe('boolean');
      const clientSessionToken = verified.body.data.token;

      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${clientSessionToken}`);
      expect(me.body.data.twoFactorMethod).toBe('EMAIL');

      await request(app).post('/api/auth/2fa/code').set('Authorization', `Bearer ${clientSessionToken}`).send({});
      const disable = await request(app)
        .post('/api/auth/2fa/disable')
        .set('Authorization', `Bearer ${clientSessionToken}`)
        .send({ password: plainPassword, code: await latestCode(user.id, 'ACCOUNT_ACTION') });
      expect(disable.status).toBe(200);

      const disabled = await prisma.user.findUnique({ where: { id: user.id } });
      expect(disabled?.twoFactorMethod).toBeNull();
    });

    it('surfaces mfaEnabled and kycStatus in getMe for a WORKER, not just ADMIN', async () => {
      const { user, plainPassword } = await createTestUser('mfa-worker-getme', { role: 'WORKER' });
      createdUserIds.push(user.id);

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: plainPassword });

      const me = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.body.data.token}`);

      expect(me.status).toBe(200);
      expect(me.body.data.mfaEnabled).toBe(false);
      expect(me.body.data.kycStatus).toEqual(expect.any(String));
    });
  });
});
