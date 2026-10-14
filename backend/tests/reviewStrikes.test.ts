import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, createTestBooking } from './helpers';

// Report -> warn -> 3rd strike suspends, for both sides of a review.
describe('Review reports and warning strikes', () => {
  const createdUserIds: string[] = [];
  let clientId: string;
  let workerId: string;
  let clientToken: string;
  let workerToken: string;
  let adminToken: string;

  const login = async (email: string, password: string) =>
    (await request(app).post('/api/auth/login').send({ email, password })).body.data.token as string;

  async function seedReview(workerResponse: string | null = null) {
    const booking = await createTestBooking({ clientId, workerId, status: 'COMPLETED' });
    const profile = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
    return prisma.review.create({
      data: { bookingId: booking.id, workerId: profile.id, clientId, rating: 1, comment: 'bad', workerResponse },
    });
  }

  beforeAll(async () => {
    const client = await createTestUser('strike-client', { role: 'CLIENT' });
    const worker = await createTestUser('strike-worker', { role: 'WORKER' });
    const admin = await createTestUser('strike-admin', { role: 'ADMIN' });
    createdUserIds.push(client.user.id, worker.user.id, admin.user.id);
    clientId = client.user.id;
    workerId = worker.user.id;
    clientToken = await login(client.user.email, client.plainPassword);
    workerToken = await login(worker.user.email, worker.plainPassword);
    adminToken = await login(admin.user.email, admin.plainPassword);
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  it('worker reports the review; the client cannot overwrite that report', async () => {
    const review = await seedReview('rude reply');

    const byWorker = await request(app)
      .post(`/api/bookings/${review.bookingId}/review/report`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ reason: 'False claims' });
    expect(byWorker.status).toBe(200);
    expect(await prisma.review.findUnique({ where: { id: review.id } })).toMatchObject({ flagged: true, flagTarget: 'REVIEW' });

    const byClient = await request(app)
      .post(`/api/bookings/${review.bookingId}/review/report`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'Insulting reply' });
    expect(byClient.status).toBe(409);
    expect(await prisma.review.findUnique({ where: { id: review.id } })).toMatchObject({ flagged: true, flagTarget: 'REVIEW' });

    // Once the admin has dealt with the worker's report, the client can report the reply.
    await prisma.review.update({ where: { id: review.id }, data: { flagged: false } });
    const again = await request(app)
      .post(`/api/bookings/${review.bookingId}/review/report`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'Insulting reply' });
    expect(again.status).toBe(200);
    expect(await prisma.review.findUnique({ where: { id: review.id } })).toMatchObject({ flagged: true, flagTarget: 'RESPONSE' });
  });

  it('warns the part the admin saw, once, and keeps the other report', async () => {
    const review = await seedReview('rude reply');
    // The client's report on the reply arrived after the admin opened the review.
    await prisma.review.update({ where: { id: review.id }, data: { flagged: true, flagTarget: 'RESPONSE' } });
    const warn = () =>
      request(app)
        .post(`/api/admin/reviews/${review.id}/warn`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Abusive language in review', target: 'REVIEW' });

    const first = await warn();
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ warningCount: 1, status: 'WARNED', flagged: true, flagTarget: 'RESPONSE' });
    expect((await warn()).status).toBe(409);

    const worker = await prisma.user.findUniqueOrThrow({ where: { id: workerId } });
    expect(worker.warningCount).toBe(0);
    // Reset so the strike count test below starts from zero.
    await prisma.user.update({ where: { id: clientId }, data: { warningCount: 0 } });
  });

  it('warns the author and suspends on the 3rd strike', async () => {
    const warn = async () => {
      const review = await seedReview();
      await prisma.review.update({ where: { id: review.id }, data: { flagged: true, flagTarget: 'REVIEW' } });
      return request(app)
        .post(`/api/admin/reviews/${review.id}/warn`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Abusive language in review', target: 'REVIEW' });
    };

    expect((await warn()).body.data).toMatchObject({ warningCount: 1, suspended: false, status: 'WARNED' });
    expect((await warn()).body.data).toMatchObject({ warningCount: 2, suspended: false });
    expect((await warn()).body.data).toMatchObject({ warningCount: 3, suspended: true });

    const client = await prisma.user.findUniqueOrThrow({ where: { id: clientId } });
    expect(client.status).toBe('SUSPENDED');
    const worker = await prisma.user.findUniqueOrThrow({ where: { id: workerId } });
    expect(worker.warningCount).toBe(0);
  });
});
