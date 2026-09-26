import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

describe('POST /api/auth/suspension-review', () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
  });

  it('tells the app the account is suspended when logging in', async () => {
    const { user, plainPassword } = await createTestUser('review-login', { role: 'WORKER', status: 'SUSPENDED' });
    createdUserIds.push(user.id);

    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('notifies admins once, then enforces a 24h cooldown', async () => {
    const { user, plainPassword } = await createTestUser('review-worker', { role: 'WORKER', status: 'SUSPENDED' });
    const { user: admin } = await createTestUser('review-admin', { role: 'ADMIN' });
    createdUserIds.push(user.id, admin.id);

    const body = { email: user.email, password: plainPassword, message: 'My rating dropped after one unfair review.' };
    const first = await request(app).post('/api/auth/suspension-review').send(body);
    const second = await request(app).post('/api/auth/suspension-review').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(429);
    expect(
      await prisma.notification.count({ where: { userId: admin.id, type: 'SUSPENSION_REVIEW_REQUESTED', relatedId: user.id } })
    ).toBe(1);
  });

  it('requires the correct password and a suspended or banned account', async () => {
    const { user: active, plainPassword } = await createTestUser('review-active', { role: 'CLIENT' });
    const { user: suspended } = await createTestUser('review-wrong-pw', { role: 'CLIENT', status: 'SUSPENDED' });
    createdUserIds.push(active.id, suspended.id);

    const message = 'Please review my account, thank you.';
    const wrongPassword = await request(app)
      .post('/api/auth/suspension-review')
      .send({ email: suspended.email, password: 'wrong-password', message });
    const notSuspended = await request(app)
      .post('/api/auth/suspension-review')
      .send({ email: active.email, password: plainPassword, message });

    expect(wrongPassword.status).toBe(401);
    expect(notSuspended.status).toBe(400);
  });
});
