import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { blockedUserIds } from '@services/blockService';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

describe('User blocks', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientId: string;
  let workerId: string;
  let clientToken: string;
  let workerToken: string;

  beforeAll(async () => {
    const { user: client, plainPassword: clientPw } = await createTestUser('block-client', { role: 'CLIENT' });
    const { user: worker, plainPassword: workerPw } = await createTestUser('block-worker', { role: 'WORKER' });
    createdUserIds.push(client.id, worker.id);
    clientId = client.id;
    workerId = worker.id;
    const booking = await createTestBooking({ clientId, workerId, status: 'COMPLETED' });
    createdBookingIds.push(booking.id);

    const [clientLogin, workerLogin] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: client.email, password: clientPw }),
      request(app).post('/api/auth/login').send({ email: worker.email, password: workerPw }),
    ]);
    clientToken = clientLogin.body.data.token;
    workerToken = workerLogin.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdBookingIds) await deleteTestBooking(id);
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  const send = (token: string, receiverId: string) =>
    request(app).post('/api/messages').set('Authorization', `Bearer ${token}`).send({ receiverId, content: 'hi' });

  it('rejects blocking yourself or an unknown user', async () => {
    const self = await request(app).post(`/api/blocks/${clientId}`).set('Authorization', `Bearer ${clientToken}`);
    expect(self.status).toBe(400);
    const missing = await request(app).post('/api/blocks/nope').set('Authorization', `Bearer ${clientToken}`);
    expect(missing.status).toBe(404);
  });

  it('blocks in both directions, lists, and unblocks', async () => {
    expect((await send(workerToken, clientId)).status).toBe(201);

    const first = await request(app).post(`/api/blocks/${workerId}`).set('Authorization', `Bearer ${clientToken}`);
    expect(first.status).toBe(200);
    // Repeating it is harmless.
    const again = await request(app).post(`/api/blocks/${workerId}`).set('Authorization', `Bearer ${clientToken}`);
    expect(again.status).toBe(200);

    expect((await send(workerToken, clientId)).status).toBe(403);
    expect((await send(clientToken, workerId)).status).toBe(403);
    expect(await blockedUserIds(workerId)).toEqual([clientId]);

    const thread = await request(app)
      .get(`/api/messages/conversations/${workerId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(thread.body.data.blockedByMe).toBe(true);
    // The blocked side is never told.
    const theirThread = await request(app)
      .get(`/api/messages/conversations/${clientId}`)
      .set('Authorization', `Bearer ${workerToken}`);
    expect(theirThread.body.data.blockedByMe).toBe(false);

    const list = await request(app).get('/api/blocks').set('Authorization', `Bearer ${clientToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.blocks.map((b: { userId: string }) => b.userId)).toEqual([workerId]);

    const unblock = await request(app).delete(`/api/blocks/${workerId}`).set('Authorization', `Bearer ${clientToken}`);
    expect(unblock.status).toBe(200);
    expect((await send(workerToken, clientId)).status).toBe(201);
  });

  it('stops the client booking a worker they blocked', async () => {
    await prisma.userBlock.create({ data: { blockerId: workerId, blockedId: clientId } });
    try {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ workerId, serviceType: 'Cleaning', address: 'x', city: 'Manila', lat: 14.5, lng: 121, date: '2030-01-01', time: '09:00' });
      expect(res.status).toBe(403);
    } finally {
      await prisma.userBlock.deleteMany({ where: { blockerId: workerId } });
    }
  });
});
