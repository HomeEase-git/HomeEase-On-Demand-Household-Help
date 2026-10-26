import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { BOOKING_PHOTO_BUCKET } from '@config/supabase';
import { getAppSettings } from '@services/appSettingsService';
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

  describe('client not here', () => {
    const notHere = (id: string) =>
      request(app).patch(`/api/bookings/${id}/client-not-here`).set('Authorization', `Bearer ${workerToken}`);

    it('alerts the client and gives the worker a cancel time', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);

      const res = await notHere(booking.id);
      expect(res.status).toBe(200);
      const { noShowGraceMinutes } = await getAppSettings();
      const at = new Date(res.body.data.clientNotHereAt).getTime();
      expect(new Date(res.body.data.canCancelAt).getTime()).toBe(at + noShowGraceMinutes * 60_000);
      expect(await prisma.notification.count({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_CLIENT_NOT_HERE' } })).toBe(1);
    });

    it('is idempotent and needs a check-in first', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);
      const first = await notHere(booking.id);
      const second = await notHere(booking.id);
      expect(second.status).toBe(200);
      expect(second.body.data.clientNotHereAt).toBe(first.body.data.clientNotHereAt);
      expect(await prisma.notification.count({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_CLIENT_NOT_HERE' } })).toBe(1);

      const early = await createTestBooking({ clientId, workerId, status: 'ACCEPTED' });
      createdBookingIds.push(early.id);
      const res = await notHere(early.id);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Check in at the job site first');
    });

    it('cancels as a client no-show without proof once the wait is over, fee auto-approved', async () => {
      const { noShowGraceMinutes, clientFaultCompensationAmount } = await getAppSettings();
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { clientNotHereAt: new Date(Date.now() - (noShowGraceMinutes + 1) * 60_000) },
      });
      const profileBefore = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ fault: 'CLIENT' });
      expect(res.status).toBe(200);
      expect(res.body.data.compensationStatus).toBe('APPROVED');

      const cancellation = await prisma.cancellation.findFirstOrThrow({ where: { bookingId: booking.id } });
      expect(cancellation.compensationStatus).toBe('APPROVED');
      expect(cancellation.reviewedById).toBeNull();
      expect((await prisma.clientProfile.findUniqueOrThrow({ where: { userId: clientId } })).paymentHoldAt).not.toBeNull();
      const profileAfter = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
      expect(profileAfter.compensationCredit - profileBefore.compensationCredit).toBe(clientFaultCompensationAmount);
      expect(await prisma.notification.count({ where: { relatedId: booking.id, type: 'CANCELLATION_COMPENSATION', user: { role: 'ADMIN' } } })).toBe(0);

      await prisma.clientProfile.update({ where: { userId: clientId }, data: { paymentHoldAt: null, outstandingBalance: 0 } });
      await prisma.workerProfile.update({ where: { userId: workerId }, data: { compensationCredit: profileBefore.compensationCredit } });
    });

    it('still needs proof before the wait is over', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);
      await prisma.booking.update({ where: { id: booking.id }, data: { clientNotHereAt: new Date() } });

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ fault: 'CLIENT' });
      expect(res.status).toBe(400);
    });
  });

  it("rejects invoice-report evidence that isn't the client's own upload", async () => {
    const booking = await createTestBooking({ clientId, workerId, status: 'PENDING_COMPLETION' });
    createdBookingIds.push(booking.id);
    const report = (evidenceUrls: string[]) =>
      request(app)
        .patch(`/api/bookings/${booking.id}/invoice/report`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'The parts charge is wrong', evidenceUrls });

    const bad = await report([photoUrl(workerId, 'someone-elses')]);
    expect(bad.status).toBe(400);
    expect((await prisma.booking.findUnique({ where: { id: booking.id } }))?.status).toBe('PENDING_COMPLETION');

    const good = await report([photoUrl(clientId, 'mine')]);
    expect(good.status).toBe(200);
  });
});
