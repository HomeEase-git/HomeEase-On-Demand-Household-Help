import crypto from 'crypto';
import http from 'http';
import request from 'supertest';
import type { Socket } from 'socket.io';
import app from '@/app';
import prisma from '@config/database';
import { TokenType } from '@prisma/client';
import { generateToken } from '@utils/jwt';
import { generateOtp, hashRefreshToken } from '@utils/otpService';
import { checkNewPassword, isPasswordBreached, BREACHED_PASSWORD_MESSAGE } from '@utils/passwordPolicy';
import { MAX_LOGIN_ATTEMPTS } from '@utils/loginAttemptLimiter';
import { revokeSessionIds, revokeUserSessions } from '@utils/tokenRevocation';
import { authenticateSocket, initSocket } from '../src/socket';
import { createTestUser, deleteTestUser } from './helpers';

// The real limiter and revocation store live in Redis, which this suite
// doesn't run (they fail open without it). In-memory stand-ins with the
// same contract let the behaviour itself be tested.
jest.mock('@utils/otpAttemptLimiter', () => {
  const counts = new Map<string, number>();
  const key = (id: string, type: string) => `${id}:${type}`;
  return {
    MAX_OTP_ATTEMPTS: 5,
    isOtpAttemptLocked: async (id: string, type: string, max = 5) => (counts.get(key(id, type)) ?? 0) >= max,
    recordFailedOtpAttempt: async (id: string, type: string) => {
      counts.set(key(id, type), (counts.get(key(id, type)) ?? 0) + 1);
    },
    clearOtpAttempts: async (id: string, type: string) => {
      counts.delete(key(id, type));
    },
  };
});

jest.mock('@utils/tokenRevocation', () => {
  const revokedUsers = new Set<string>();
  const revokedSessions = new Set<string>();
  let listener: any = null;
  return {
    setRevocationListener: (l: any) => {
      listener = l;
    },
    revokeUserSessions: async (userId: string) => {
      listener?.onUserRevoked(userId);
      revokedUsers.add(userId);
    },
    clearUserSessionRevocation: async (userId: string) => {
      revokedUsers.delete(userId);
    },
    isUserSessionRevoked: async (userId: string) => revokedUsers.has(userId),
    revokeSessionIds: async (ids: string[]) => {
      if (ids.length === 0) return;
      listener?.onSessionsRevoked(ids);
      ids.forEach((id) => revokedSessions.add(id));
    },
    isSessionRevoked: async (id: string) => revokedSessions.has(id),
  };
});

describe('Session & login hardening', () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  async function signIn(label: string) {
    const { user, plainPassword } = await createTestUser(label, { role: 'CLIENT' });
    createdUserIds.push(user.id);
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
    expect(res.status).toBe(200);
    return { user, plainPassword, token: res.body.data.token as string, refreshToken: res.body.data.refreshToken as string };
  }

  const refresh = (refreshToken: string) => request(app).post('/api/auth/refresh').send({ refreshToken });
  const me = (token: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

  describe('refresh tokens', () => {
    it('are stored hashed, and rotate on use', async () => {
      const { refreshToken } = await signIn('rt-rotate');

      const stored = await prisma.authToken.findMany({ where: { token: { in: [refreshToken, hashRefreshToken(refreshToken)] } } });
      expect(stored).toHaveLength(1);
      expect(stored[0].token).toBe(hashRefreshToken(refreshToken));

      const res = await refresh(refreshToken);
      expect(res.status).toBe(200);
      expect(res.body.data.refreshToken).not.toBe(refreshToken);
      expect((await me(res.body.data.token)).status).toBe(200);
    });

    it('treats an immediate second use as a race, not theft', async () => {
      const { refreshToken } = await signIn('rt-race');
      const first = await refresh(refreshToken);
      expect(first.status).toBe(200);

      const second = await refresh(refreshToken);
      expect(second.status).toBe(401);
      expect(second.body.code).toBe('REFRESH_RACE');
      // The session survives: the winner's token still works.
      expect((await refresh(first.body.data.refreshToken)).status).toBe(200);
    });

    it('revokes the whole session when a rotated token is replayed later', async () => {
      const { user, refreshToken } = await signIn('rt-reuse');
      const first = await refresh(refreshToken);
      expect(first.status).toBe(200);

      // Push the rotation outside the race window.
      await prisma.authToken.updateMany({
        where: { token: hashRefreshToken(refreshToken) },
        data: { usedAt: new Date(Date.now() - 60_000) },
      });

      expect((await refresh(refreshToken)).status).toBe(401);
      expect((await refresh(first.body.data.refreshToken)).status).toBe(401);
      expect((await me(first.body.data.token)).status).toBe(401);

      const audit = await prisma.auditLog.findFirst({ where: { actorId: user.id, action: 'REFRESH_TOKEN_REUSE' } });
      expect(audit).not.toBeNull();
    });

    it('still accepts a refresh token stored before hashing', async () => {
      const { user } = await signIn('rt-legacy');
      const legacy = 'a'.repeat(80);
      await prisma.authToken.create({
        data: { userId: user.id, token: legacy, type: TokenType.REFRESH, expiresAt: new Date(Date.now() + 86_400_000) },
      });

      expect((await refresh(legacy)).status).toBe(200);
    });
  });

  describe('admin session limits', () => {
    const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

    async function adminSignIn(label: string) {
      const { user, plainPassword } = await createTestUser(label, { role: 'ADMIN' });
      createdUserIds.push(user.id);
      const res = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
      expect(res.status).toBe(200);
      return { user, token: res.body.data.token as string, refreshToken: res.body.data.refreshToken as string };
    }

    it('caps admin access tokens at 15 minutes and refresh tokens at the idle window', async () => {
      const { token, refreshToken } = await adminSignIn('admin-limits');
      const claims = decode(token);
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(15 * 60);

      const row = await prisma.authToken.findFirst({ where: { token: hashRefreshToken(refreshToken) } });
      const minutesLeft = (row!.expiresAt.getTime() - Date.now()) / 60_000;
      expect(minutesLeft).toBeGreaterThan(44);
      expect(minutesLeft).toBeLessThanOrEqual(45);

      expect((await refresh(refreshToken)).status).toBe(200);
    });

    it('ends an admin session 12 hours after sign-in, however active', async () => {
      const { refreshToken } = await adminSignIn('admin-max');
      const row = await prisma.authToken.findFirst({ where: { token: hashRefreshToken(refreshToken) } });
      // Signed in 13 hours ago; this token was just issued by a recent refresh.
      await prisma.authToken.update({ where: { id: row!.id }, data: { createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000) } });

      const res = await refresh(refreshToken);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_EXPIRED');
      expect(await prisma.authToken.count({ where: { sessionId: row!.sessionId } })).toBe(0);
    });

    it('never lets a renewed admin token outlive the 12-hour limit', async () => {
      const { refreshToken } = await adminSignIn('admin-cap');
      const row = await prisma.authToken.findFirst({ where: { token: hashRefreshToken(refreshToken) } });
      // Signed in 11h50m ago: the renewed token must stop at the 12h mark (10 min), not run 45 min.
      await prisma.authToken.update({ where: { id: row!.id }, data: { createdAt: new Date(Date.now() - (11 * 60 + 50) * 60 * 1000) } });

      const res = await refresh(refreshToken);
      expect(res.status).toBe(200);
      const renewed = await prisma.authToken.findFirst({ where: { token: hashRefreshToken(res.body.data.refreshToken) } });
      const minutesLeft = (renewed!.expiresAt.getTime() - Date.now()) / 60_000;
      expect(minutesLeft).toBeLessThanOrEqual(10);
      expect(minutesLeft).toBeGreaterThan(9);
    });

    it('leaves client sessions at 30 days', async () => {
      const { refreshToken } = await signIn('client-30d');
      const row = await prisma.authToken.findFirst({ where: { token: hashRefreshToken(refreshToken) } });
      expect((row!.expiresAt.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29);
    });
  });

  describe('logout', () => {
    it('ends the refresh token and the current access token', async () => {
      const { token, refreshToken } = await signIn('logout');

      const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).send({ refreshToken });
      expect(res.status).toBe(200);

      expect((await me(token)).status).toBe(401);
      expect((await refresh(refreshToken)).status).toBe(401);
    });

    it('ends this device even when the app sends no refresh token', async () => {
      const { token, refreshToken } = await signIn('logout-no-rt');

      const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(200);

      expect((await refresh(refreshToken)).status).toBe(401);
    });
  });

  describe('login lockout', () => {
    it(`locks an account after ${MAX_LOGIN_ATTEMPTS} wrong passwords, even for the right one`, async () => {
      const { user, plainPassword } = await createTestUser('lockout', { role: 'CLIENT' });
      createdUserIds.push(user.id);

      for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
        const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPass999' });
        expect(res.status).toBe(401);
      }

      const res = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
      expect(res.status).toBe(429);
    });

    it('locks an unknown email the same way, so lockouts do not reveal accounts', async () => {
      const email = `e2etest.nobody-lockout.${Date.now()}@homeease.invalid`;
      for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
        await request(app).post('/api/auth/login').send({ email, password: 'WrongPass999' });
      }
      const res = await request(app).post('/api/auth/login').send({ email, password: 'WrongPass999' });
      expect(res.status).toBe(429);
    });

    it('resets the count after a successful sign-in', async () => {
      const { user, plainPassword } = await createTestUser('lockout-reset', { role: 'CLIENT' });
      createdUserIds.push(user.id);

      for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
        await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPass999' });
      }
      expect((await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword })).status).toBe(200);
      await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPass999' });
      expect((await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword })).status).toBe(200);
    });
  });

  describe('password policy', () => {
    it('rejects a sign-up password under 10 characters', async () => {
      const res = await request(app).post('/api/auth/signup').send({
        fullName: 'Short Password',
        email: `e2etest.shortpw.${Date.now()}@homeease.invalid`,
        phone: '09171234567',
        password: 'Abcdefg12',
        role: 'CLIENT',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least 10 characters/);
    });

    it('rejects passwords longer than bcrypt can use', async () => {
      expect(await checkNewPassword(`A1${'x'.repeat(80)}`)).toMatch(/at most 72/);
    });

    it('change-password keeps this device signed in and signs out the others', async () => {
      const { user, plainPassword } = await createTestUser('changepw', { role: 'CLIENT' });
      createdUserIds.push(user.id);
      const login = () => request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
      const deviceA = (await login()).body.data;
      const deviceB = (await login()).body.data;

      const weak = await request(app)
        .post('/api/users/me/change-password')
        .set('Authorization', `Bearer ${deviceA.token}`)
        .send({ currentPassword: plainPassword, newPassword: 'Short1' });
      expect(weak.status).toBe(400);

      const res = await request(app)
        .post('/api/users/me/change-password')
        .set('Authorization', `Bearer ${deviceA.token}`)
        .send({ currentPassword: plainPassword, newPassword: 'NewSecurePass2026' });
      expect(res.status).toBe(200);

      expect((await refresh(deviceA.refreshToken)).status).toBe(200);
      expect((await refresh(deviceB.refreshToken)).status).toBe(401);
      expect((await me(deviceB.token)).status).toBe(401);
    });
  });

  describe('breached-password check', () => {
    const realFetch = global.fetch;
    const setting = process.env.PASSWORD_BREACH_CHECK;

    beforeEach(() => {
      process.env.PASSWORD_BREACH_CHECK = 'true';
    });
    afterEach(() => {
      global.fetch = realFetch;
      process.env.PASSWORD_BREACH_CHECK = setting;
    });

    const password = 'Password12345';
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();

    it('sends only the 5-char hash prefix and matches the suffix', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        text: async () => `0000000000000000000000000000000000A:0\r\n${sha1.slice(5)}:4213\r\n`,
      }));
      global.fetch = fetchMock as any;

      expect(await isPasswordBreached(password)).toBe(true);
      expect(await checkNewPassword(password)).toBe(BREACHED_PASSWORD_MESSAGE);
      expect((fetchMock.mock.calls[0] as any[])[0]).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
    });

    it('ignores padding entries and fails open when the service is down', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, text: async () => `${sha1.slice(5)}:0\r\n` })) as any;
      expect(await isPasswordBreached(password)).toBe(false);

      global.fetch = jest.fn(async () => {
        throw new Error('network down');
      }) as any;
      expect(await isPasswordBreached(password)).toBe(false);
    });
  });

  describe('one-time codes', () => {
    it('are 6 digits', () => {
      for (let i = 0; i < 50; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
    });
  });

  describe('socket handshake', () => {
    const handshake = async (token: string) => {
      const socket = { handshake: { auth: { token } }, data: {} } as unknown as Socket;
      return new Promise<Error | undefined>((resolve) => {
        authenticateSocket(socket, resolve);
      });
    };

    it('accepts a live session token', async () => {
      const { token } = await signIn('socket-ok');
      expect(await handshake(token)).toBeUndefined();
    });

    it('rejects an MFA challenge token', async () => {
      const { user } = await signIn('socket-mfa');
      const challenge = generateToken({ userId: user.id, email: user.email, role: user.role, type: 'mfa_pending' }, 300);
      expect((await handshake(challenge))?.message).toBe('Invalid or expired token');
    });

    it('rejects a revoked session', async () => {
      const { token } = await signIn('socket-revoked');
      const sid = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sid;
      await revokeSessionIds([sid], 900);
      expect((await handshake(token))?.message).toBe('Your session has been revoked');
    });

    it('drops live sockets when a session or account is revoked', async () => {
      const server = http.createServer();
      const io = initSocket(server);
      const disconnectSockets = jest.fn();
      const inSpy = jest.spyOn(io, 'in').mockReturnValue({ disconnectSockets } as any);

      await revokeSessionIds(['sid-1', 'sid-2'], 900);
      expect(inSpy).toHaveBeenCalledWith(['session:sid-1', 'session:sid-2']);

      await revokeUserSessions('user-1', 900);
      expect(inSpy).toHaveBeenCalledWith('user-1');
      expect(disconnectSockets).toHaveBeenCalledWith(true);

      io.close();
      server.close();
    });
  });
});
