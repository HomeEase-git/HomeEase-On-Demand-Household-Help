import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { encryptField } from '@utils/fieldEncryption';
import { createTestBooking, createTestUser, deleteTestUser } from './helpers';

describe('DELETE /api/users/me', () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
  });

  async function login(email: string, password: string) {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    return res.body.data.token as string;
  }

  it('erases personal data but keeps booking records', async () => {
    const { user: worker, plainPassword } = await createTestUser('delete-worker', { role: 'WORKER' });
    const { user: client } = await createTestUser('delete-client', { role: 'CLIENT' });
    createdUserIds.push(worker.id, client.id);

    await prisma.user.update({ where: { id: worker.id }, data: { phone: '09171234567', pushToken: 'ExponentPushToken[x]' } });
    await prisma.workerProfile.update({
      where: { userId: worker.id },
      data: {
        bio: 'Aircon tech',
        address: '1 Test St',
        payoutAccountNumber: encryptField('09171234567'),
        tin: encryptField('123-456-789-000'),
        currentLat: 14.6,
        currentLng: 121,
      },
    });
    await prisma.userAddress.create({ data: { userId: worker.id, street: '1 Test St', city: 'Manila' } });
    const booking = await createTestBooking({ clientId: client.id, workerId: worker.id, status: 'COMPLETED' });

    const token = await login(worker.email, plainPassword);
    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: plainPassword });

    expect(res.status).toBe(200);

    const dbUser = await prisma.user.findUnique({ where: { id: worker.id }, include: { workerProfile: true, addresses: true } });
    expect(dbUser).toMatchObject({
      fullName: 'Deleted user',
      phone: null,
      pushToken: null,
      status: 'DELETED',
      isDeleted: true,
    });
    expect(dbUser?.email).not.toBe(worker.email);
    expect(dbUser?.addresses).toHaveLength(0);
    expect(dbUser?.workerProfile).toMatchObject({
      bio: null,
      address: null,
      payoutAccountNumber: null,
      tin: null,
      currentLat: null,
    });
    // The client's booking history survives.
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).not.toBeNull();

    // The old credentials no longer work.
    const relogin = await request(app).post('/api/auth/login').send({ email: worker.email, password: plainPassword });
    expect(relogin.status).not.toBe(200);
  });

  it('refuses while a booking is still in progress', async () => {
    const { user: client, plainPassword } = await createTestUser('delete-busy-client', { role: 'CLIENT' });
    createdUserIds.push(client.id);
    await createTestBooking({ clientId: client.id, status: 'PENDING' });

    const token = await login(client.email, plainPassword);
    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: plainPassword });

    expect(res.status).toBe(409);
    expect(res.body.blockers[0]).toMatch(/still in progress/);
    expect((await prisma.user.findUnique({ where: { id: client.id } }))?.status).toBe('ACTIVE');
  });

  it('requires the correct password', async () => {
    const { user: client, plainPassword } = await createTestUser('delete-wrong-pw', { role: 'CLIENT' });
    createdUserIds.push(client.id);

    const token = await login(client.email, plainPassword);
    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'not-my-password' });

    expect(res.status).toBe(401);
  });
});
