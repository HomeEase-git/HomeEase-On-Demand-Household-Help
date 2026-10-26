import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { BOOKING_PHOTO_BUCKET } from '@config/supabase';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const CLIENT_LOCATION = { lat: 14.5995, lng: 120.9842 };
const NEARBY_WORKER_LOCATION = { lat: 14.5995 + 0.0005, lng: 120.9842 };

/** A booking photo URL "uploaded" by this user (see utils/storageUrls). */
function photoUrl(userId: string, name: string) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/${userId}/${name}.jpg`;
}

describe('Booking gaps — notifications and detail fields', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientToken: string;
  let clientId: string;
  let workerToken: string;
  let workerId: string;

  beforeAll(async () => {
    const { user: client, plainPassword: clientPw } = await createTestUser('booking-gaps-client', { role: 'CLIENT' });
    const { user: worker, plainPassword: workerPw } = await createTestUser('booking-gaps-worker', { role: 'WORKER' });
    createdUserIds.push(client.id, worker.id);
    clientId = client.id;
    workerId = worker.id;

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

  it('tells the client the worker arrived with BOOKING_ARRIVED', async () => {
    const booking = await createTestBooking({
      clientId,
      workerId,
      status: 'ACCEPTED',
      clientLat: CLIENT_LOCATION.lat,
      clientLng: CLIENT_LOCATION.lng,
    });
    createdBookingIds.push(booking.id);

    const res = await request(app)
      .patch(`/api/bookings/${booking.id}/arrive`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send(NEARBY_WORKER_LOCATION);
    expect(res.status).toBe(200);

    expect(await prisma.notification.findFirst({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_ARRIVED' } })).not.toBeNull();
  });

  it('tells the client the job started with BOOKING_STARTED', async () => {
    const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
    createdBookingIds.push(booking.id);

    const res = await request(app)
      .patch(`/api/bookings/${booking.id}/start`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ beforePhotoUrls: [`${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/${workerId}/before.jpg`] });
    expect(res.status).toBe(200);

    expect(await prisma.notification.findFirst({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_STARTED' } })).not.toBeNull();
  });

  it('returns the new detail fields', async () => {
    const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED' });
    createdBookingIds.push(booking.id);

    const res = await request(app).get(`/api/bookings/${booking.id}`).set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      clientNotHereAt: null,
      clientNoShowCancelAt: null,
      cancelRequestedAt: null,
      cancelRequestReason: null,
      cancelRequestEscalatedAt: null,
      hasOpenDispute: false,
    });
  });

  it.each(['PENDING_COMPLETION', 'AWAITING_PAYMENT', 'DISPUTED'] as const)(
    'refuses a worker cancel once the invoice is sent (%s)',
    async (status) => {
      const booking = await createTestBooking({ clientId, workerId, status });
      createdBookingIds.push(booking.id);
      await prisma.booking.update({ where: { id: booking.id }, data: { workerArrivedAt: new Date(), workerCompletedAt: new Date() } });

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ reason: 'Changed my mind about it', fault: 'CLIENT', proofUrls: [photoUrl(workerId, 'x')] });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("The invoice is sent, so this job can't be cancelled here. If something is wrong, contact support.");

      const after = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(after?.status).toBe(status);
      expect(await prisma.cancellation.count({ where: { bookingId: booking.id } })).toBe(0);
    }
  );
});
