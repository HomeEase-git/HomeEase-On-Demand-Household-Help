import crypto from 'crypto';
import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { BOOKING_PHOTO_BUCKET } from '@config/supabase';
import { getAppSettings, invalidateAppSettingsCache } from '@services/appSettingsService';
import { sendSmsToUser } from '@utils/smsService';
import { addDays, phTodayStart } from '@services/workerAvailabilityService';
import { cancelAsWorkerNoShow, nudgeStuckBookings, remindAndAutoSettleCompletions } from '@workers/bookingWorker';
import { notifyUser } from '@utils/notify';
import type { Prisma } from '@prisma/client';
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
    // Real dev-DB admins get the admin alerts too: remove what these tests sent,
    // keyed by the test bookings and the disputes opened on them.
    const disputes = await prisma.dispute.findMany({ where: { bookingId: { in: createdBookingIds } }, select: { id: true } });
    await prisma.notification.deleteMany({
      where: { relatedId: { in: [...createdBookingIds, ...disputes.map((d) => d.id)] } },
    });
    for (const id of createdBookingIds) await deleteTestBooking(id);
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  /**
   * The controller's next booking read returns the row as it is now, then the
   * row is changed underneath it: the request acts on a stale status.
   */
  let staleSpy: jest.SpyInstance | null = null;
  afterEach(() => {
    staleSpy?.mockRestore();
    staleSpy = null;
  });
  function staleRead(bookingId: string, change: Prisma.BookingUncheckedUpdateInput) {
    const real = prisma.booking.findUnique.bind(prisma.booking);
    const spy = jest.spyOn(prisma.booking, 'findUnique');
    staleSpy = spy; // restored in afterEach if the request never reads the booking
    spy.mockImplementation((async (args: Prisma.BookingFindUniqueArgs) => {
      const row = await real(args);
      if (args.where.id === bookingId) {
        spy.mockRestore();
        await prisma.booking.update({ where: { id: bookingId }, data: change });
      }
      return row;
    }) as never);
  }

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

  it('gives the generic status message for a worker cancel on a cancelled booking', async () => {
    const booking = await createTestBooking({ clientId, workerId, status: 'CANCELLED' });
    createdBookingIds.push(booking.id);

    const res = await request(app)
      .patch(`/api/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ workerCancellationReason: 'OTHER' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Cannot cancel booking with status CANCELLED');
  });

  describe('client not here', () => {
    const notHere = (id: string) =>
      request(app).patch(`/api/bookings/${id}/client-not-here`).set('Authorization', `Bearer ${workerToken}`);

    // Booked yesterday, so the start is long past and the wait counts from the alert.
    const pastStart = () => addDays(phTodayStart(), -1);

    it('alerts the client and gives the worker a cancel time', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date(), scheduledDate: pastStart() });
      createdBookingIds.push(booking.id);

      const res = await notHere(booking.id);
      expect(res.status).toBe(200);
      const { noShowGraceMinutes } = await getAppSettings();
      const at = new Date(res.body.data.clientNotHereAt).getTime();
      expect(new Date(res.body.data.canCancelAt).getTime()).toBe(at + noShowGraceMinutes * 60_000);
      expect(await prisma.notification.count({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_CLIENT_NOT_HERE' } })).toBe(1);
    });

    it('answers two parallel alerts with 200 and alerts the client once', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);
      const [a, b] = await Promise.all([notHere(booking.id), notHere(booking.id)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(a.body.data.clientNotHereAt).toBe(b.body.data.clientNotHereAt);
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
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date(), scheduledDate: pastStart() });
      createdBookingIds.push(booking.id);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { clientNotHereAt: new Date(Date.now() - (noShowGraceMinutes + 1) * 60_000) },
      });
      const profileBefore = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
      const clientBefore = await prisma.clientProfile.findUniqueOrThrow({ where: { userId: clientId } });

      try {
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
        const fee = await prisma.notification.findFirstOrThrow({ where: { userId: clientId, relatedId: booking.id, type: 'CANCELLATION_COMPENSATION' } });
        expect(fee.message).toMatch(/until it's settled\. If you were home or want to pay, contact support\.$/);
      } finally {
        await prisma.clientProfile.update({
          where: { userId: clientId },
          data: {
            paymentHoldAt: clientBefore.paymentHoldAt,
            paymentHoldNote: clientBefore.paymentHoldNote,
            outstandingBalance: clientBefore.outstandingBalance,
          },
        });
        await prisma.workerProfile.update({ where: { userId: workerId }, data: { compensationCredit: profileBefore.compensationCredit } });
      }
    });

    it('a WORKER-fault cancel after the wait is the normal penalty path, with no client fee', async () => {
      const { noShowGraceMinutes, noShowPenaltyAmount } = await getAppSettings();
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date(), scheduledDate: pastStart() });
      createdBookingIds.push(booking.id);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { clientNotHereAt: new Date(Date.now() - (noShowGraceMinutes + 1) * 60_000) },
      });
      await prisma.workerProfile.update({ where: { userId: workerId }, data: { activeJobCount: { increment: 1 } } });
      const before = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });

      try {
        const res = await request(app)
          .patch(`/api/bookings/${booking.id}/cancel`)
          .set('Authorization', `Bearer ${workerToken}`)
          .send({ fault: 'WORKER', reason: 'My motorbike broke down', proofUrls: [photoUrl(workerId, 'bike')] });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ compensationStatus: 'NOT_APPLICABLE', penaltyAmount: noShowPenaltyAmount });
        const cancellation = await prisma.cancellation.findFirstOrThrow({ where: { bookingId: booking.id } });
        expect(cancellation).toMatchObject({ fault: 'WORKER', compensationAmount: null, penalizedWorkerId: workerId });
        expect(await prisma.notification.count({ where: { userId: clientId, relatedId: booking.id, type: 'CANCELLATION_COMPENSATION' } })).toBe(0);
      } finally {
        await prisma.workerProfile.update({
          where: { userId: workerId },
          data: { commissionOwed: before.commissionOwed, debtHoldAt: before.debtHoldAt },
        });
      }
    });

    it('does not auto-approve a client no-show once the job is in progress', async () => {
      const { noShowGraceMinutes } = await getAppSettings();
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS', workerArrivedAt: new Date(), scheduledDate: pastStart() });
      createdBookingIds.push(booking.id);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { clientNotHereAt: new Date(Date.now() - (noShowGraceMinutes + 1) * 60_000) },
      });

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ fault: 'CLIENT' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Explain what happened (at least 10 characters)');
      expect(await prisma.cancellation.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    it('counts the wait from the booked start after an early check-in', async () => {
      const { noShowGraceMinutes } = await getAppSettings();
      // Booked tomorrow: the worker checked in early, and the alert's own wait is over.
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);
      await prisma.arrivalVerification.create({
        data: { bookingId: booking.id, workerLat: 0, workerLng: 0, distanceMeters: 0, isVerified: true, isOutsideBookedWindow: false },
      });
      const alert = await notHere(booking.id);
      expect(alert.status).toBe(200);
      const start = new Date(`${booking.scheduledDate.toISOString().slice(0, 10)}T09:00:00+08:00`).getTime();
      expect(new Date(alert.body.data.canCancelAt).getTime()).toBe(start + noShowGraceMinutes * 60_000);

      await prisma.booking.update({
        where: { id: booking.id },
        data: { clientNotHereAt: new Date(Date.now() - (noShowGraceMinutes + 1) * 60_000) },
      });
      const detail = await request(app).get(`/api/bookings/${booking.id}`).set('Authorization', `Bearer ${workerToken}`);
      expect(new Date(detail.body.data.clientNoShowCancelAt).getTime()).toBe(start + noShowGraceMinutes * 60_000);

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ fault: 'CLIENT' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Explain what happened (at least 10 characters)');
      expect(await prisma.cancellation.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    it('needs proof when the check-in was flagged outside the booked window', async () => {
      const { noShowGraceMinutes } = await getAppSettings();
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date(), scheduledDate: pastStart() });
      createdBookingIds.push(booking.id);
      await prisma.arrivalVerification.create({
        data: { bookingId: booking.id, workerLat: 0, workerLng: 0, distanceMeters: 0, isVerified: true, isOutsideBookedWindow: true },
      });
      const alert = await notHere(booking.id);
      expect(alert.status).toBe(200);
      expect(alert.body.data.canCancelAt).toBeNull();
      await prisma.booking.update({
        where: { id: booking.id },
        data: { clientNotHereAt: new Date(Date.now() - (noShowGraceMinutes + 1) * 60_000) },
      });
      const detail = await request(app).get(`/api/bookings/${booking.id}`).set('Authorization', `Bearer ${workerToken}`);
      expect(detail.body.data.clientNoShowCancelAt).toBeNull();

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ fault: 'CLIENT' });
      expect(res.status).toBe(400);
      expect(await prisma.cancellation.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    /** Runs `fn` with the client-fault fee set to 0, then restores it. */
    async function withZeroFee(fn: () => Promise<void>) {
      const settings = await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
      await prisma.appSettings.update({ where: { id: 'singleton' }, data: { clientFaultCompensationAmount: 0 } });
      invalidateAppSettingsCache();
      try {
        await fn();
      } finally {
        await prisma.appSettings.update({
          where: { id: 'singleton' },
          data: { clientFaultCompensationAmount: settings.clientFaultCompensationAmount },
        });
        invalidateAppSettingsCache();
      }
    }

    /** A proof cancel blaming the client, filed while the fee is 0. */
    async function zeroFeeProofCancel() {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);
      await prisma.workerProfile.update({ where: { userId: workerId }, data: { activeJobCount: { increment: 1 } } });
      let res!: request.Response;
      await withZeroFee(async () => {
        res = await request(app)
          .patch(`/api/bookings/${booking.id}/cancel`)
          .set('Authorization', `Bearer ${workerToken}`)
          .send({ fault: 'CLIENT', reason: 'Gate locked and nobody answered', proofUrls: [photoUrl(workerId, 'locked-gate')] });
      });
      return { booking, res };
    }
    const review = (bookingId: string, decision: 'APPROVE' | 'REJECT') =>
      request(app)
        .patch(`/api/admin/cancellations/${bookingId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ decision, note: 'Checked the photos against the booking' });

    it('with a zero fee, a proof cancel blaming the client still goes to review, with no fee wording', async () => {
      const { booking, res } = await zeroFeeProofCancel();
      expect(res.status).toBe(200);
      expect(res.body.data.compensationStatus).toBe('PENDING_REVIEW');
      expect(res.body.message).toBe('Booking cancelled — HomeEase will review your proof');
      const cancellation = await prisma.cancellation.findFirstOrThrow({ where: { bookingId: booking.id } });
      expect(cancellation).toMatchObject({ compensationStatus: 'PENDING_REVIEW', compensationAmount: null });
      expect(cancellation.proofUrls).toHaveLength(1);
      const alert = await prisma.notification.findFirstOrThrow({
        where: { userId: createdUserIds[2], relatedId: booking.id, type: 'CANCELLATION_COMPENSATION', title: 'Cancellation Needs Review' },
      });
      expect(alert.message).not.toMatch(/compensation|fee/i);
      const note = await prisma.notification.findFirstOrThrow({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_CANCELLED' } });
      expect(note.message).not.toMatch(/fee|₱/);
    });

    it('approving a no-fee claim only marks it approved: no hold, credit or ledger post', async () => {
      const { booking } = await zeroFeeProofCancel();
      const clientBefore = await prisma.clientProfile.findUniqueOrThrow({ where: { userId: clientId } });
      const workerBefore = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });

      // The fee is back to its real value now; the old claim must not pick it up.
      const res = await review(booking.id, 'APPROVE');
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Claim approved');
      expect((await prisma.cancellation.findFirstOrThrow({ where: { bookingId: booking.id } })).compensationStatus).toBe('APPROVED');
      const clientAfter = await prisma.clientProfile.findUniqueOrThrow({ where: { userId: clientId } });
      expect(clientAfter).toMatchObject({ paymentHoldAt: clientBefore.paymentHoldAt, outstandingBalance: clientBefore.outstandingBalance });
      const workerAfter = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
      expect(workerAfter).toMatchObject({ compensationCredit: workerBefore.compensationCredit, commissionOwed: workerBefore.commissionOwed });
      expect(await prisma.ledgerTransaction.count({ where: { bookingId: booking.id } })).toBe(0);
      const told = await prisma.notification.findMany({ where: { relatedId: booking.id, userId: { in: [clientId, workerId] }, title: { in: ['Cancellation reviewed', 'Cancellation proof accepted'] } } });
      expect(told).toHaveLength(2);
      for (const n of told) expect(n.message).not.toMatch(/₱/);
    });

    it('rejecting a no-fee claim still penalizes the worker', async () => {
      const { noShowPenaltyAmount } = await getAppSettings();
      const { booking } = await zeroFeeProofCancel();
      const before = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
      try {
        const res = await review(booking.id, 'REJECT');
        expect(res.status).toBe(200);
        const cancellation = await prisma.cancellation.findFirstOrThrow({ where: { bookingId: booking.id } });
        expect(cancellation).toMatchObject({ compensationStatus: 'REJECTED', fault: 'WORKER', penalizedWorkerId: workerId });
        const after = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
        expect(after.commissionOwed - before.commissionOwed).toBeCloseTo(noShowPenaltyAmount);
      } finally {
        await prisma.workerProfile.update({
          where: { userId: workerId },
          data: { commissionOwed: before.commissionOwed, debtHoldAt: before.debtHoldAt },
        });
      }
    });

    it('with a zero fee, cancels with no fee, no hold and no review', async () => {
      const { noShowGraceMinutes } = await getAppSettings();
      await withZeroFee(async () => {
        const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date(), scheduledDate: pastStart() });
        createdBookingIds.push(booking.id);
        await prisma.booking.update({
          where: { id: booking.id },
          data: { clientNotHereAt: new Date(Date.now() - (noShowGraceMinutes + 1) * 60_000) },
        });

        const res = await request(app)
          .patch(`/api/bookings/${booking.id}/cancel`)
          .set('Authorization', `Bearer ${workerToken}`)
          .send({ fault: 'CLIENT' });
        expect(res.status).toBe(200);
        expect(res.body.data.compensationStatus).toBe('NOT_APPLICABLE');
        const cancellation = await prisma.cancellation.findFirstOrThrow({ where: { bookingId: booking.id } });
        expect(cancellation).toMatchObject({ compensationStatus: 'NOT_APPLICABLE', compensationAmount: null });
        expect((await prisma.clientProfile.findUniqueOrThrow({ where: { userId: clientId } })).paymentHoldAt).toBeNull();
        expect(await prisma.notification.count({ where: { relatedId: booking.id, type: 'CANCELLATION_COMPENSATION' } })).toBe(0);
        const note = await prisma.notification.findFirstOrThrow({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_CANCELLED' } });
        expect(note.message).not.toMatch(/fee|₱/);
        expect(await prisma.notification.count({ where: { userId: workerId, relatedId: booking.id, type: 'BOOKING_CANCELLED' } })).toBe(1);
      });
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

  it("rejects refund evidence that isn't the client's own upload", async () => {
    // A payment id that doesn't exist: the evidence check runs first, so an
    // own photo gets the normal 404 and someone else's is 400.
    const refund = (evidenceUrls: string[]) =>
      request(app)
        .post(`/api/payments/${crypto.randomUUID()}/refund`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Job was not done', evidenceUrls });

    const bad = await refund([photoUrl(workerId, 'someone-elses')]);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Upload the photos again — one of them could not be verified');
    expect((await refund([photoUrl(clientId, 'mine')])).status).toBe(404);
  });

  it('adds an invoice report to an open problem dispute instead of opening a second', async () => {
    const booking = await createTestBooking({ clientId, workerId, status: 'PENDING_COMPLETION' });
    createdBookingIds.push(booking.id);
    const open = await prisma.dispute.create({
      data: { bookingId: booking.id, raisedById: clientId, reason: 'Worker stopped the job', status: 'OPEN' },
    });

    const res = await request(app)
      .patch(`/api/bookings/${booking.id}/invoice/report`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'The parts charge is wrong', evidenceUrls: [photoUrl(clientId, 'receipt')] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'DISPUTED', disputeId: open.id });
    expect(await prisma.dispute.count({ where: { bookingId: booking.id } })).toBe(1);
    const dispute = await prisma.dispute.findUniqueOrThrow({ where: { id: open.id } });
    expect(dispute.reason).toBe('Worker stopped the job\n[client] Invoice reported: The parts charge is wrong');
    expect(dispute.raisedById).toBe(clientId);
    expect(dispute.evidenceUrls).toHaveLength(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('DISPUTED');
  });

  it('notifyUser never throws, so a committed action stays a success', async () => {
    const spy = jest.spyOn(prisma.notification, 'create').mockRejectedValueOnce(new Error('db down'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(notifyUser({ userId: clientId, type: 'BOOKING_REMINDER', title: 't', message: 'm' })).resolves.toBeNull();
    } finally {
      spy.mockRestore();
      errorLog.mockRestore();
    }
  });

  it('dismisses an open dispute when the booking is cancelled as a worker no-show', async () => {
    const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', scheduledDate: addDays(phTodayStart(), -2) });
    createdBookingIds.push(booking.id);
    await prisma.workerProfile.update({ where: { userId: workerId }, data: { activeJobCount: { increment: 1 } } });
    const dispute = await prisma.dispute.create({
      data: { bookingId: booking.id, raisedById: clientId, reason: 'Worker is not here', status: 'OPEN' },
    });

    expect(await cancelAsWorkerNoShow(booking, { noShowGraceMinutes: 60, noShowPenaltyAmount: 0 })).toBe(true);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe('RESOLVED_DISMISSED');
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
      const clientBefore = await prisma.clientProfile.findUniqueOrThrow({ where: { userId: clientId } });

      const asked = await problem(booking.id, { reason: 'NEED_TO_CANCEL', note: 'Plans changed' });
      expect(asked.status).toBe(200);
      expect(asked.body.data.outcome).toBe('CANCEL_REQUESTED');
      expect(await prisma.notification.count({ where: { userId: workerId, relatedId: booking.id, type: 'BOOKING_CANCEL_REQUESTED' } })).toBe(1);
      expect((await problem(booking.id, { reason: 'NEED_TO_CANCEL' })).status).toBe(409);

      const res = await respond(booking.id, true);
      expect(res.status).toBe(200);
      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { cancellation: true } });
      expect(after.status).toBe('CANCELLED');
      expect(after.cancellation).toMatchObject({
        reason: 'CLIENT_CANCEL_AGREED',
        penalizedWorkerId: null,
        compensationStatus: 'NOT_APPLICABLE',
      });
      const profile = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
      expect(profile.commissionOwed).toBe(before.commissionOwed);
      expect(profile.activeJobCount).toBe(before.activeJobCount - 1);
      const clientAfter = await prisma.clientProfile.findUniqueOrThrow({ where: { userId: clientId } });
      expect(clientAfter.paymentHoldAt).toBeNull();
      expect(clientAfter.outstandingBalance).toBe(clientBefore.outstandingBalance);
    });

    it('NEED_TO_CANCEL that loses a race to a status change is a status conflict, not "already asked"', async () => {
      const booking = await seed('ACCEPTED');
      staleRead(booking.id, { status: 'IN_PROGRESS', workerStartedAt: new Date() });
      const res = await problem(booking.id, { reason: 'NEED_TO_CANCEL' });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('This booking was just updated. Refresh and try again.');
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).cancelRequestedAt).toBeNull();
    });

    it('opens no dispute when the booking moved past the reported status', async () => {
      const booking = await seed('IN_PROGRESS');
      staleRead(booking.id, { status: 'PENDING_COMPLETION', workerCompletedAt: new Date() });
      const res = await problem(booking.id, { reason: 'WORKER_STOPPED' });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('This booking was just updated. Refresh and try again.');
      expect(await prisma.dispute.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    it('a declined cancel request joins a dispute that is already open', async () => {
      const booking = await seed('IN_PROGRESS');
      expect((await problem(booking.id, { reason: 'NEED_TO_CANCEL', note: 'Moving house' })).status).toBe(200);
      const open = await prisma.dispute.create({
        data: { bookingId: booking.id, raisedById: clientId, reason: 'Worker stopped the job', status: 'OPEN' },
      });

      expect((await respond(booking.id, false)).status).toBe(200);
      expect(await prisma.dispute.count({ where: { bookingId: booking.id } })).toBe(1);
      const dispute = await prisma.dispute.findUniqueOrThrow({ where: { id: open.id } });
      expect(dispute.reason).toBe('Worker stopped the job\n[client] Client asked to cancel (Moving house); worker declined');
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).cancelRequestEscalatedAt).not.toBeNull();
    });

    it('a failed escalation leaves the request unescalated so it can be retried', async () => {
      const booking = await seed('ACCEPTED');
      expect((await problem(booking.id, { reason: 'NEED_TO_CANCEL' })).status).toBe(200);

      // Make the dispute insert inside the escalation transaction fail.
      const realTransaction = prisma.$transaction.bind(prisma);
      const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
        realTransaction((tx) =>
          fn(
            new Proxy(tx, {
              get: (target, prop) =>
                prop === 'dispute'
                  ? new Proxy(target.dispute, {
                      get: (d, p) => (p === 'create' ? () => Promise.reject(new Error('transient db error')) : Reflect.get(d, p)),
                    })
                  : Reflect.get(target, prop),
            })
          )
        )) as never);
      try {
        expect((await respond(booking.id, false)).status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).cancelRequestEscalatedAt).toBeNull();
      expect(await prisma.dispute.count({ where: { bookingId: booking.id } })).toBe(0);

      expect((await respond(booking.id, false)).status).toBe(200);
      expect(await prisma.dispute.count({ where: { bookingId: booking.id, status: 'OPEN' } })).toBe(1);
    });

    it('NEED_TO_CANCEL then worker declines: escalated to a dispute, and a second answer is 409', async () => {
      const booking = await seed('ACCEPTED');
      expect((await problem(booking.id, { reason: 'NEED_TO_CANCEL' })).status).toBe(200);

      const res = await respond(booking.id, false);
      expect(res.status).toBe(200);
      expect(await prisma.dispute.count({ where: { bookingId: booking.id, status: 'OPEN' } })).toBe(1);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).cancelRequestEscalatedAt).not.toBeNull();
      const told = await prisma.notification.findFirstOrThrow({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_PROBLEM_REPORTED' } });
      expect(told.message).toBe("Your worker didn't agree to cancel, so HomeEase will decide. We'll tell you the outcome.");

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

  /**
   * These tests run the real sweep on purpose (its queries are what's under
   * test), but the dev DB is a copy of real data, so its top-level scans are
   * narrowed to this file's bookings: genuinely overdue real rows are left
   * alone. Test-only spies; production code has no test filter.
   */
  function scopeSweepToTestRows() {
    type FindMany = { findMany: (args?: { where?: object }) => Promise<unknown> };
    const narrow = (delegate: FindMany, where: () => object) => {
      const real = delegate.findMany.bind(delegate);
      return jest
        .spyOn(delegate, 'findMany')
        .mockImplementation(((args: { where?: object } = {}) => real({ ...args, where: { AND: [args.where ?? {}, where()] } })) as never);
    };
    const spies = [
      narrow(prisma.booking as unknown as FindMany, () => ({ id: { in: createdBookingIds } })),
      narrow(prisma.payment as unknown as FindMany, () => ({ bookingId: { in: createdBookingIds } })),
      narrow(prisma.payout as unknown as FindMany, () => ({ id: { in: [] } })),
    ];
    return () => spies.forEach((spy) => spy.mockRestore());
  }

  describe('stuck-booking sweep', () => {
    // Real clock with timestamps backdated rather than a fake future "now".
    let unscope: () => void;
    beforeEach(() => (unscope = scopeSweepToTestRows()));
    afterEach(() => unscope());
    const MIN = 60_000;
    const HOUR = 60 * MIN;
    const ago = (ms: number) => new Date(Date.now() - ms);

    async function seedStuck(status: 'ACCEPTED' | 'IN_PROGRESS', data: Prisma.BookingUncheckedUpdateInput = {}, daysFromToday = -10) {
      const created = await createTestBooking({
        clientId,
        workerId,
        status,
        scheduledDate: addDays(phTodayStart(new Date()), daysFromToday),
        scheduledTime: '09:00',
      });
      createdBookingIds.push(created.id);
      return prisma.booking.update({ where: { id: created.id }, data });
    }
    const notes = (id: string, userId: string) =>
      prisma.notification.findMany({ where: { userId, relatedId: id, type: 'BOOKING_REMINDER' }, orderBy: { createdAt: 'asc' } });
    const reload = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
    const openDisputes = (id: string) => prisma.dispute.count({ where: { bookingId: id, status: 'OPEN' } });

    it('escalates a cancel request nobody answered within 2h', async () => {
      const fresh = await seedStuck('IN_PROGRESS', { cancelRequestedAt: ago(HOUR), cancelRequestReason: 'Need to go' });
      const old = await seedStuck('IN_PROGRESS', { cancelRequestedAt: ago(2 * HOUR + MIN), cancelRequestReason: 'Need to go' });

      await nudgeStuckBookings();
      expect(await openDisputes(fresh.id)).toBe(0);
      expect(await openDisputes(old.id)).toBe(1);
      expect((await reload(old.id)).cancelRequestEscalatedAt).not.toBeNull();
    });

    it('gives the worker 15 min when the request comes after the booked start', async () => {
      const tooSoon = await seedStuck('ACCEPTED', { cancelRequestedAt: ago(10 * MIN), cancelRequestReason: 'Sick' });
      const waited = await seedStuck('ACCEPTED', { cancelRequestedAt: ago(16 * MIN), cancelRequestReason: 'Sick' });

      await nudgeStuckBookings();
      expect(await openDisputes(tooSoon.id)).toBe(0);
      expect(await openDisputes(waited.id)).toBe(1);
    });

    it('reminds the worker once, 30 min after check-in on time, and nudges the client at 2h', async () => {
      const early = await seedStuck('ACCEPTED', { workerArrivedAt: ago(29 * MIN) });
      const late = await seedStuck('ACCEPTED', { workerArrivedAt: ago(31 * MIN) });

      await nudgeStuckBookings();
      await nudgeStuckBookings();
      expect(await notes(early.id, workerId)).toHaveLength(0);
      const [reminder, ...rest] = await notes(late.id, workerId);
      expect(reminder.title).toBe('Tap Start Job');
      expect(rest).toHaveLength(0);
      expect(await notes(late.id, clientId)).toHaveLength(0);

      const long = await seedStuck('ACCEPTED', { workerArrivedAt: ago(2 * HOUR + MIN) });
      await nudgeStuckBookings();
      expect((await notes(long.id, clientId)).map((n) => n.title)).toEqual(['Is your job under way?']);
    });

    it('does not nudge the client when the worker said the client is not here', async () => {
      const booking = await seedStuck('ACCEPTED', { workerArrivedAt: ago(3 * HOUR), clientNotHereAt: ago(2 * HOUR) });

      await nudgeStuckBookings();
      expect(await notes(booking.id, workerId)).toHaveLength(1);
      expect(await notes(booking.id, clientId)).toHaveLength(0);
    });

    it("doesn't point the client at Report a problem while a dispute is open", async () => {
      const unstarted = await seedStuck('ACCEPTED', { workerArrivedAt: ago(3 * HOUR) });
      const running = await seedStuck('IN_PROGRESS', { workerStartedAt: ago(49 * HOUR) });
      for (const b of [unstarted, running]) {
        await prisma.dispute.create({ data: { bookingId: b.id, raisedById: clientId, reason: 'Something is wrong', status: 'OPEN' } });
      }

      await nudgeStuckBookings();
      expect(await notes(unstarted.id, workerId)).toHaveLength(1);
      expect(await notes(unstarted.id, clientId)).toHaveLength(0);
      expect(await notes(running.id, workerId)).toHaveLength(1);
      expect(await notes(running.id, clientId)).toHaveLength(0);
      expect(await notes(running.id, createdUserIds[2])).toHaveLength(1);
    });

    it('waits for the booked start after an early check-in', async () => {
      // Booked tomorrow, so the start is hours away.
      const booking = await seedStuck('ACCEPTED', { workerArrivedAt: ago(3 * HOUR) }, 1);

      await nudgeStuckBookings();
      expect(await notes(booking.id, workerId)).toHaveLength(0);
    });

    it('nudges a job in progress for 49h, and leaves one with a visit tomorrow alone', async () => {
      const adminId = createdUserIds[2];
      const mid = await seedStuck('IN_PROGRESS', { workerStartedAt: ago(13 * HOUR) });
      const stuck = await seedStuck('IN_PROGRESS', { workerStartedAt: ago(49 * HOUR) });
      const planned = await seedStuck('IN_PROGRESS', { workerStartedAt: ago(49 * HOUR) });
      await prisma.bookingVisit.create({ data: { bookingId: planned.id, scheduledDate: addDays(phTodayStart(new Date()), 1), scheduledTime: '09:00' } });

      await nudgeStuckBookings();
      await nudgeStuckBookings();
      expect((await notes(mid.id, workerId)).map((n) => n.title)).toEqual(['Finish or schedule a follow-up']);
      expect(await notes(mid.id, clientId)).toHaveLength(0);
      expect((await notes(stuck.id, workerId)).map((n) => n.title)).toEqual(['Finish or schedule a follow-up']);
      expect((await notes(stuck.id, clientId)).map((n) => n.title)).toEqual(['Is your job finished?']);
      expect(await notes(stuck.id, adminId)).toHaveLength(1);
      expect((await reload(stuck.id)).progressEscalatedAt).not.toBeNull();
      expect(await notes(planned.id, workerId)).toHaveLength(0);
      expect(await notes(planned.id, clientId)).toHaveLength(0);
    });
  });

  describe('cash invoices', () => {
    const HOUR = 60 * 60_000;
    // Real clock, backdated invoices; the sweep is scoped to this file's rows.
    let unscope: () => void;
    beforeEach(() => (unscope = scopeSweepToTestRows()));
    afterEach(() => unscope());
    async function seedInvoice(hoursAgo: number, data: Prisma.BookingUncheckedUpdateInput = {}) {
      const created = await createTestBooking({ clientId, workerId, status: 'PENDING_COMPLETION' });
      createdBookingIds.push(created.id);
      return prisma.booking.update({
        where: { id: created.id },
        data: { paymentMethodType: 'CASH', workerCompletedAt: new Date(Date.now() - hoursAgo * HOUR), ...data },
      });
    }
    const status = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;
    const second = (id: string, userId: string) =>
      prisma.notification.count({ where: { userId, relatedId: id, type: 'COMPLETION_REMINDER', title: { not: 'Did you get the cash?' } } });

    it('records cash as paid after 72h, not 24h', async () => {
      const day = await seedInvoice(25);
      const late = await seedInvoice(73);
      await remindAndAutoSettleCompletions();
      expect(await status(day.id)).toBe('PENDING_COMPLETION');
      expect(await status(late.id)).toBe('COMPLETED');
    });

    it('sends the second cash reminder once, at 48h', async () => {
      const early = await seedInvoice(25);
      const due = await seedInvoice(49);
      await remindAndAutoSettleCompletions();
      await remindAndAutoSettleCompletions();
      const dueNotes = await prisma.notification.findMany({
        where: { relatedId: due.id, type: 'COMPLETION_REMINDER', message: { contains: 'in 1 day' } },
      });
      expect(dueNotes).toHaveLength(1);
      expect(dueNotes[0].userId).toBe(clientId);
      expect(await prisma.notification.count({ where: { relatedId: due.id, userId: workerId, type: 'COMPLETION_REMINDER', title: 'Did you get the cash?' } })).toBeGreaterThanOrEqual(1);
      expect(await prisma.notification.count({ where: { relatedId: early.id, message: { contains: 'in 1 day' } } })).toBe(0);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: due.id } })).cashSecondReminderSentAt).not.toBeNull();
    });

    it('never auto-settles a booking that went through a dispute', async () => {
      const booking = await seedInvoice(100, { disputeResolvedAt: new Date() });
      await remindAndAutoSettleCompletions();
      expect(await status(booking.id)).toBe('PENDING_COMPLETION');
    });

    it('never auto-settles or warns while a problem dispute is still open', async () => {
      const late = await seedInvoice(73);
      const due = await seedInvoice(49);
      for (const b of [late, due]) {
        await prisma.dispute.create({ data: { bookingId: b.id, raisedById: clientId, reason: 'Worker stopped the job', status: 'OPEN' } });
      }
      await remindAndAutoSettleCompletions();
      expect(await status(late.id)).toBe('PENDING_COMPLETION');
      expect(await prisma.notification.count({ where: { relatedId: due.id, message: { contains: 'in 1 day' } } })).toBe(0);
    });

    it('sends no second reminder for a booking that went through a dispute', async () => {
      const booking = await seedInvoice(49, { disputeResolvedAt: new Date() });
      await remindAndAutoSettleCompletions();
      expect(await prisma.notification.count({ where: { relatedId: booking.id, message: { contains: 'in 1 day' } } })).toBe(0);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).cashSecondReminderSentAt).toBeNull();
    });

    it('lets the worker report that the client did not pay', async () => {
      const booking = await seedInvoice(1);
      const res = await request(app).patch(`/api/bookings/${booking.id}/cash-not-paid`).set('Authorization', `Bearer ${workerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: booking.id, status: 'DISPUTED' });
      const dispute = await prisma.dispute.findFirstOrThrow({ where: { bookingId: booking.id } });
      expect(dispute).toMatchObject({ status: 'OPEN', reason: 'Worker reports the client has not paid the cash invoice', raisedById: workerId });
      expect(res.body.data.disputeId).toBe(dispute.id);
      expect(await prisma.notification.count({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_PROBLEM_REPORTED' } })).toBe(1);

      const again = await request(app).patch(`/api/bookings/${booking.id}/cash-received`).set('Authorization', `Bearer ${workerToken}`);
      expect(again.status).toBe(409);
    });

    it('refuses cash-not-paid on a GCash booking', async () => {
      const booking = await seedInvoice(1, { paymentMethodType: 'GCASH' });
      const res = await request(app).patch(`/api/bookings/${booking.id}/cash-not-paid`).set('Authorization', `Bearer ${workerToken}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('This client pays with GCash or Maya in the app');
    });
  });
});
