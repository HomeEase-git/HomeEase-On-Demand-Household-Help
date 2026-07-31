import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

describe('Auth', () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  describe('POST /api/auth/login', () => {
    it('rejects an email that does not exist', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody-e2etest@homeease.invalid', password: 'whatever123' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects a wrong password for a real account', async () => {
      const { user } = await createTestUser('login-wrongpw', { role: 'CLIENT' });
      createdUserIds.push(user.id);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'not-the-real-password' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('logs in successfully with correct credentials and returns a token', async () => {
      const { user, plainPassword } = await createTestUser('login-ok', { role: 'ADMIN' });
      createdUserIds.push(user.id);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: plainPassword });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.role).toBe('ADMIN');
      expect(res.body.data.email).toBe(user.email);
    });

    it('rejects login for a suspended account', async () => {
      const { user, plainPassword } = await createTestUser('login-suspended', {
        role: 'CLIENT',
        status: 'SUSPENDED',
      });
      createdUserIds.push(user.id);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: plainPassword });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/auth/me', () => {
    it('rejects requests with no token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns the authenticated user for a valid token', async () => {
      const { user, plainPassword } = await createTestUser('me-ok', { role: 'CLIENT' });
      createdUserIds.push(user.id);

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: plainPassword });
      const token = login.body.data.token;

      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(user.id);
      expect(res.body.data.email).toBe(user.email);
    });
  });

  describe('Admin route gating', () => {
    it('blocks a non-admin token from an admin-only route', async () => {
      const { user, plainPassword } = await createTestUser('gate-nonadmin', { role: 'CLIENT' });
      createdUserIds.push(user.id);

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: plainPassword });
      const token = login.body.data.token;

      const res = await request(app)
        .get('/api/admin/users/clients')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('allows an admin token through the same admin-only route', async () => {
      const { user, plainPassword } = await createTestUser('gate-admin', { role: 'ADMIN' });
      createdUserIds.push(user.id);

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: plainPassword });
      const token = login.body.data.token;

      const res = await request(app)
        .get('/api/admin/users/clients')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});