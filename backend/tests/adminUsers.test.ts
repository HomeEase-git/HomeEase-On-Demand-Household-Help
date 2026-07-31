import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

describe('Admin suspend user', () => {
  const createdUserIds: string[] = [];
  let adminToken: string;

  beforeAll(async () => {
    const { user, plainPassword } = await createTestUser('suspend-admin', { role: 'ADMIN' });
    createdUserIds.push(user.id);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: plainPassword });
    adminToken = login.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  it('suspends an active client and the client can no longer log in', async () => {
    const { user: client, plainPassword } = await createTestUser('suspend-target', { role: 'CLIENT' });
    createdUserIds.push(client.id);

    // Sanity check: can log in before suspension.
    const preLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: client.email, password: plainPassword });
    expect(preLogin.status).toBe(200);

    const suspendRes = await request(app)
      .patch(`/api/admin/users/${client.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SUSPENDED', reason: 'Violation of terms', notes: 'e2e test' });

    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.data.status).toBe('SUSPENDED');

    const dbUser = await prisma.user.findUnique({ where: { id: client.id } });
    expect(dbUser?.status).toBe('SUSPENDED');
    expect(dbUser?.isDeleted).toBe(true);

    const postLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: client.email, password: plainPassword });

    expect(postLogin.status).toBe(403);
  });

  it('reactivates a suspended user back to ACTIVE', async () => {
    const { user: client, plainPassword } = await createTestUser('reactivate-target', {
      role: 'CLIENT',
      status: 'SUSPENDED',
    });
    createdUserIds.push(client.id);

    const res = await request(app)
      .patch(`/api/admin/users/${client.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);

    const dbUser = await prisma.user.findUnique({ where: { id: client.id } });
    expect(dbUser?.status).toBe('ACTIVE');
    expect(dbUser?.isDeleted).toBe(false);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: client.email, password: plainPassword });
    expect(login.status).toBe(200);
  });

  it('rejects an invalid status value', async () => {
    const { user: client } = await createTestUser('invalid-status-target', { role: 'CLIENT' });
    createdUserIds.push(client.id);

    const res = await request(app)
      .patch(`/api/admin/users/${client.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'NOT_A_REAL_STATUS' });

    expect(res.status).toBe(400);
  });
});