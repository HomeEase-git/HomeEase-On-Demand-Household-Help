import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { BOOKING_PHOTO_BUCKET } from '@config/supabase';
import { getAppSettings } from '@services/appSettingsService';
import { sendSmsToUser } from '@utils/smsService';
import { addDays, phTodayStart } from '@services/workerAvailabilityService';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

jest.mock('@utils/smsService', () => ({
  ...jest.requireActual('@utils/smsService'),
  sendSmsToUser: jest.fn().mockResolvedValue(undefined),
}));

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
  let adminToken: string;

  beforeAll(async () => {
    const { user: client, plainPassword: clientPw } = await createTestUser('booking-gaps-client', { role: 'CLIENT' });
    const { user: worker, plainPassword: workerPw } = await createTestUser('booking-gaps-worker', { role: 'WORKER' });
    const { user: admin, plainPassword: adminPw } = await createTestUser('booking-gaps-admin', { role: 'ADMIN' });
    createdUserIds.push(client.id, worker.id, admin.id);
    clientId = client.id;
    workerId = worker.id;

    const [clientLogin, workerLogin, adminLogin] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: client.email, password: clientPw }),
      request(app).post('/api/auth/login').send({ email: worker.email, password: workerPw }),
      request(app).post('/api/auth/login').send({ email: admin.email, password: adminPw }),
    ]);
    clientToken = clientLogin.body.data.token;
    workerToken = workerLogin.body.data.token;
    adminToken = adminLogin.body.data.token;
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

  describe('report a problem and cancel requests', () => {
    const problem = (id: string, body: Record<string, unknown>) =>
      request(app).post(`/api/bookings/${id}/problem`).set('Authorization', `Bearer ${clientToken}`).send(body);
    const respond = (id: string, accept: boolean) =>
      request(app)
        .patch(`/api/bookings/${id}/cancel-request/respond`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ accept });
    const seed = async (status: 'ACCEPTED' | 'IN_PROGRESS' | 'PENDING_COMPLETION', extra: { scheduledDate?: Date } = {}) => {
      const booking = await createTestBooking({ clientId, workerId, status, ...extra });
      createdBookingIds.push(booking.id);
      return booking;
    };

    beforeEach(() => jest.mocked(sendSmsToUser).mockClear());

    it('pings the worker before the deadline and returns autoCancelAt', async () => {
      const booking = await seed('ACCEPTED');
      const res = await problem(booking.id, { reason: 'WORKER_NOT_HERE' });
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('WORKER_PINGED');
      const { noShowGraceMinutes } = await getAppSettings();
      const start = new Date(`${booking.scheduledDate.toISOString().slice(0, 10)}T09:00:00+08:00`).getTime();
      expect(new Date(res.body.data.autoCancelAt).getTime()).toBe(start + noShowGraceMinutes * 60_000);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).workerPingedAt).not.toBeNull();
    });

    it('a second ping within 15 min is 429, with one SMS and notification only', async () => {
      const booking = await seed('ACCEPTED');
      expect((await problem(booking.id, { reason: 'WORKER_NOT_HERE' })).status).toBe(200);
      const again = await problem(booking.id, { reason: 'WORKER_NOT_HERE' });
      expect(again.status).toBe(429);
      expect(again.body.message).toBe('We already pinged your worker. Give them a few minutes.');
      expect(await prisma.notification.count({ where: { userId: workerId, relatedId: booking.id, type: 'BOOKING_REMINDER' } })).toBe(1);
      expect(jest.mocked(sendSmsToUser).mock.calls.filter(([arg]) => arg.userId === workerId)).toHaveLength(1);
    });

    it('cancels as a no-show past the deadline', async () => {
      const booking = await seed('ACCEPTED', { scheduledDate: addDays(phTodayStart(), -2) });
      await prisma.workerProfile.update({ where: { userId: workerId }, data: { activeJobCount: { increment: 1 } } });
      const before = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });

      const res = await problem(booking.id, { reason: 'WORKER_NOT_HERE' });
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('CANCELLED');
      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { cancellation: true } });
      expect(after.status).toBe('CANCELLED');
      expect(after.cancellation?.reason).toBe('WORKER_NO_SHOW');

      await prisma.workerProfile.update({
        where: { userId: workerId },
        data: { commissionOwed: before.commissionOwed, debtHoldAt: before.debtHoldAt },
      });
    });

    it('WORKER_STOPPED opens one dispute, and a repeat is 409', async () => {
      const booking = await seed('IN_PROGRESS');
      const res = await problem(booking.id, { reason: 'WORKER_STOPPED', note: 'Left after an hour' });
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('REPORTED');
      expect(await prisma.notification.count({ where: { userId: workerId, relatedId: booking.id, type: 'BOOKING_PROBLEM_REPORTED' } })).toBe(1);

      const again = await problem(booking.id, { reason: 'WORKER_STOPPED' });
      expect(again.status).toBe(409);
      expect(again.body.message).toBe('You already reported this. HomeEase is on it.');
      expect(await prisma.dispute.count({ where: { bookingId: booking.id } })).toBe(1);
    });

    it('OTHER without a note is 400', async () => {
      const booking = await seed('IN_PROGRESS');
      expect((await problem(booking.id, { reason: 'OTHER' })).status).toBe(400);
    });

    it('NEED_TO_CANCEL then worker agrees: cancelled, no penalty', async () => {
      const booking = await seed('ACCEPTED');
      await prisma.workerProfile.update({ where: { userId: workerId }, data: { activeJobCount: { increment: 1 } } });
      const before = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });

      const asked = await problem(booking.id, { reason: 'NEED_TO_CANCEL', note: 'Plans changed' });
      expect(asked.status).toBe(200);
      expect(asked.body.data.outcome).toBe('CANCEL_REQUESTED');
      expect(await prisma.notification.count({ where: { userId: workerId, relatedId: booking.id, type: 'BOOKING_CANCEL_REQUESTED' } })).toBe(1);
      expect((await problem(booking.id, { reason: 'NEED_TO_CANCEL' })).status).toBe(409);

      const res = await respond(booking.id, true);
      expect(res.status).toBe(200);
      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { cancellation: true } });
      expect(after.status).toBe('CANCELLED');
      expect(after.cancellation).toMatchObject({ reason: 'CLIENT_CANCEL_AGREED', penalizedWorkerId: null });
      const profile = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
      expect(profile.commissionOwed).toBe(before.commissionOwed);
      expect(profile.activeJobCount).toBe(before.activeJobCount - 1);
    });

    it('NEED_TO_CANCEL then worker declines: escalated to a dispute, and a second answer is 409', async () => {
      const booking = await seed('ACCEPTED');
      expect((await problem(booking.id, { reason: 'NEED_TO_CANCEL' })).status).toBe(200);

      const res = await respond(booking.id, false);
      expect(res.status).toBe(200);
      expect(await prisma.dispute.count({ where: { bookingId: booking.id, status: 'OPEN' } })).toBe(1);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).cancelRequestEscalatedAt).not.toBeNull();

      const again = await respond(booking.id, true);
      expect(again.status).toBe(409);
      expect(again.body.message).toBe('There is no cancel request to answer');
    });

    it('agreeing after the invoice is sent is 409 with no Cancellation row', async () => {
      const booking = await seed('IN_PROGRESS');
      expect((await problem(booking.id, { reason: 'NEED_TO_CANCEL' })).status).toBe(200);
      await prisma.booking.update({ where: { id: booking.id }, data: { status: 'PENDING_COMPLETION', workerCompletedAt: new Date() } });

      expect((await respond(booking.id, true)).status).toBe(409);
      expect(await prisma.cancellation.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    it('refuses a problem report once the invoice is sent', async () => {
      const booking = await seed('PENDING_COMPLETION');
      const res = await problem(booking.id, { reason: 'WORKER_STOPPED' });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('You can report a problem here until your worker sends the invoice');
    });

    it("lets an admin cancel an IN_PROGRESS booking's dispute", async () => {
      const booking = await seed('IN_PROGRESS');
      await prisma.workerProfile.update({ where: { userId: workerId }, data: { activeJobCount: { increment: 1 } } });
      expect((await problem(booking.id, { reason: 'WORKER_STOPPED' })).status).toBe(200);
      const dispute = await prisma.dispute.findFirstOrThrow({ where: { bookingId: booking.id } });

      const res = await request(app)
        .patch(`/api/admin/disputes/${dispute.id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'CANCEL_BOOKING', resolution: 'Worker left the job' });
      expect(res.status).toBe(200);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
    });
  });
});
