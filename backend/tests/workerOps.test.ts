import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { BOOKING_PHOTO_BUCKET } from '@config/supabase';
import { cancelWorkerNoShows } from '@workers/bookingWorker';
import { addDays, isoDay, phTodayStart } from '@services/workerAvailabilityService';
import { completeWorkerSetup, createTestUser, deleteTestUser } from './helpers';

// Codes and receipts never leave the test run.
jest.mock('@utils/emailService', () => ({
  ...jest.requireActual('@utils/emailService'),
  sendOtpEmail: jest.fn().mockResolvedValue(undefined),
}));

const PASSWORD = 'TestPass123!';

async function login(email: string, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res;
}

/** A booking photo URL "uploaded" by this user (see utils/storageUrls). */
function photoUrl(userId: string, name: string) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/${userId}/${name}.jpg`;
}

describe('worker operations overhaul', () => {
  const createdUserIds: string[] = [];
  const createdServiceTypeIds: string[] = [];
  let workerId: string;
  let workerEmail: string;
  let workerToken: string;
  let workerProfileId: string;
  let clientId: string;
  let clientEmail: string;
  let clientToken: string;
  let adminToken: string;
  let serviceTypeName: string;
  let serviceTaskId: string;

  beforeAll(async () => {
    const worker = await createTestUser('ops-worker', { role: 'WORKER' });
    const client = await createTestUser('ops-client', { role: 'CLIENT' });
    const admin = await createTestUser('ops-admin', { role: 'ADMIN' });
    createdUserIds.push(worker.user.id, client.user.id, admin.user.id);
    workerId = worker.user.id;
    workerEmail = worker.user.email;
    clientId = client.user.id;
    clientEmail = client.user.email;

    await prisma.workerProfile.update({ where: { userId: workerId }, data: { kycStatus: 'APPROVED', yearsExperience: 3 } });
    const setup = await completeWorkerSetup(workerId);
    createdServiceTypeIds.push(setup.createdServiceTypeId!);
    serviceTaskId = setup.serviceTaskId;
    const task = await prisma.serviceTask.findUniqueOrThrow({ where: { id: serviceTaskId }, include: { serviceType: true } });
    serviceTypeName = task.serviceType.name;
    workerProfileId = (await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } })).id;

    workerToken = (await login(workerEmail)).body.data.token;
    clientToken = (await login(clientEmail)).body.data.token;
    adminToken = (await login(admin.user.email)).body.data.token;
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
    for (const id of createdServiceTypeIds) await prisma.serviceType.delete({ where: { id } }).catch(() => undefined);
  });

  function bookingBody(date: string, time: string, extra: Record<string, unknown> = {}) {
    return {
      workerId,
      serviceType: serviceTypeName,
      serviceTaskId,
      address: '123 Test St',
      city: 'Manila',
      lat: 14.5995,
      lng: 120.9842,
      date,
      time,
      paymentMethodType: 'CASH',
      ...extra,
    };
  }

  async function seedBooking(data: Record<string, unknown>) {
    return prisma.booking.create({
      data: {
        clientId,
        workerId,
        serviceType: serviceTypeName,
        serviceTaskId,
        description: 'ops test',
        location: '123 Test St',
        city: 'Manila',
        clientLat: 14.5995,
        clientLng: 120.9842,
        scheduledDate: addDays(phTodayStart(), 3),
        scheduledTime: '09:00',
        estimatedPrice: 800,
        paymentMethodType: 'CASH',
        status: 'ACCEPTED',
        ...data,
      },
    });
  }

  describe('booking times, rush fee and availability', () => {
    it('books an exact start time and prices a same-day booking as rush', async () => {
      const later = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(isoDay(addDays(phTodayStart(), 4)), '10:00'));
      expect(later.status).toBe(201);
      expect(later.body.data).toMatchObject({ scheduledTime: '10:00', isRush: false });
      expect(later.body.data.pricing.rushFee).toBe(0);

      // Same day, as late as allowed so the 2-hour lead time is met.
      const today = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(isoDay(phTodayStart()), '18:00'));
      if (today.status === 400) {
        // It's already past 16:00 in the Philippines — no same-day slot left.
        expect(today.body.message).toMatch(/at least 2 hours/);
      } else {
        expect(today.status).toBe(201);
        expect(today.body.data.isRush).toBe(true);
        // 25% of the ₱500 service price.
        expect(today.body.data.pricing.rushFee).toBe(125);
        expect(today.body.data.estimatedPrice).toBe(later.body.data.estimatedPrice + 125);
      }
    });

    it('prices a per-unit job from the quantity the client books, within the job limits', async () => {
      const original = await prisma.serviceTask.findUniqueOrThrow({ where: { id: serviceTaskId } });
      await prisma.serviceTask.update({
        where: { id: serviceTaskId },
        data: { pricingModel: 'PER_UNIT', unitLabel: 'unit', maxQuantity: 5 },
      });
      try {
        const day = isoDay(addDays(phTodayStart(), 25));
        const book = (extra: Record<string, unknown>) =>
          request(app).post('/api/bookings').set('Authorization', `Bearer ${clientToken}`).send(bookingBody(day, '10:00', extra));

        const missing = await book({});
        expect(missing.status).toBe(400);
        expect(missing.body.message).toMatch(/how many/i);
        expect((await book({ quantity: 6 })).status).toBe(400);

        const res = await book({ quantity: 3 });
        expect(res.status).toBe(201);
        const saved = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.data.id } });
        expect(saved.quantity).toBe(3);
        expect(saved.scopeAnswers).toBeNull();
        expect(res.body.data.pricing.basePrice).toBe(original.basePrice * 3);
      } finally {
        await prisma.serviceTask.update({
          where: { id: serviceTaskId },
          data: { pricingModel: original.pricingModel, unitLabel: original.unitLabel, maxQuantity: null },
        });
      }
    });

    it('bills a package the client chose at checkout without a second approval, and itemises the worker take-home', async () => {
      const task = await prisma.serviceTask.findUniqueOrThrow({ where: { id: serviceTaskId } });
      const pkg = await prisma.workerPackage.create({
        data: {
          workerProfileId,
          serviceTypeId: task.serviceTypeId,
          name: 'Deep Clean Package',
          price: 1600,
          isActive: true,
          status: 'APPROVED',
        },
      });

      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(isoDay(addDays(phTodayStart(), 22)), '10:00', { packageIds: [pkg.id] }));
      expect(res.status).toBe(201);

      // The client's choice is the consent: the row starts approved, not pending.
      const rows = await prisma.bookingAddOn.findMany({ where: { bookingId: res.body.data.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Deep Clean Package', price: 1600 });
      expect(rows[0].clientApprovedAt).not.toBeNull();
      expect(rows[0].clientRejectedAt).toBeNull();

      const estimated = res.body.data.estimatedPrice as number;

      // Client's breakdown already includes it.
      const asClient = await request(app)
        .get(`/api/bookings/${res.body.data.id}`)
        .set('Authorization', `Bearer ${clientToken}`);
      expect(asClient.status).toBe(200);
      expect(asClient.body.data.priceBreakdown.addOns).toEqual([{ name: 'Deep Clean Package', price: 1600 }]);
      expect(asClient.body.data.priceBreakdown.subtotal).toBe(estimated + 1600);
      expect(asClient.body.data.earnings).toBeNull(); // worker-only

      // Worker's card is built on that same subtotal, and its lines add up.
      const asWorker = await request(app)
        .get(`/api/bookings/${res.body.data.id}`)
        .set('Authorization', `Bearer ${workerToken}`);
      const e = asWorker.body.data.earnings;
      expect(e.isEstimate).toBe(true);
      expect(e.subtotal).toBe(estimated + 1600);
      expect(e.subtotal - e.commissionAmount - e.withholdingTaxAmount + e.tip + e.vatAmount).toBeCloseTo(e.workerPayout, 2);
    });

    it('ignores client-supplied prices and rejects a negative tip', async () => {
      const honest = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(isoDay(addDays(phTodayStart(), 11)), '10:00'));
      expect(honest.status).toBe(201);

      const tampered = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(
          bookingBody(isoDay(addDays(phTodayStart(), 12)), '10:00', {
            estimatedPrice: 1,
            finalPrice: 1,
            totalPrice: 1,
            total: 1,
            addOns: [{ name: 'Free discount', price: -500 }],
          }),
        );
      expect(tampered.status).toBe(201);
      expect(tampered.body.data.estimatedPrice).toBe(honest.body.data.estimatedPrice);
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: tampered.body.data.id } });
      expect(stored.estimatedPrice).toBe(honest.body.data.estimatedPrice);
      expect(stored.finalPrice).toBeNull();
      expect(stored.addOnsSnapshot).toEqual([{ kind: 'PREFERENCE', name: 'Free discount', price: 0 }]);

      const negativeTip = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(isoDay(addDays(phTodayStart(), 13)), '10:00', { tip: -100 }));
      expect(negativeTip.status).toBe(400);
    });

    it('rejects times outside 7:00-18:00 and dates the worker has closed', async () => {
      const date = isoDay(addDays(phTodayStart(), 5));
      const early = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(date, '05:00'));
      expect(early.status).toBe(400);

      const close = await request(app)
        .put('/api/workers/me/date-overrides')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ dates: [date], isAvailable: false });
      expect(close.status).toBe(200);

      const closed = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(date, '09:00'));
      expect(closed.status).toBe(409);

      const blocked = await request(app).get(`/api/workers/${workerId}/blocked-dates`);
      expect(blocked.body.data.dates).toContain(date);
    });

    it('lets a worker take several jobs on one day', async () => {
      const date = isoDay(addDays(phTodayStart(), 6));
      for (const time of ['08:00', '11:00', '15:00']) {
        const res = await request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${clientToken}`)
          .send(bookingBody(date, time));
        expect(res.status).toBe(201);
        const accept = await request(app).patch(`/api/bookings/${res.body.data.id}/accept`).set('Authorization', `Bearer ${workerToken}`);
        expect(accept.status).toBe(200);
      }

      const calendar = await request(app)
        .get(`/api/workers/me/calendar?from=${date}&to=${date}`)
        .set('Authorization', `Bearer ${workerToken}`);
      expect(calendar.status).toBe(200);
      expect(calendar.body.data.days[0]).toMatchObject({ date, available: true, jobCount: 3 });

      // A day with accepted jobs can't be closed.
      const close = await request(app)
        .put('/api/workers/me/date-overrides')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ dates: [date], isAvailable: false });
      expect(close.status).toBe(409);
    });

    it('refuses to accept a second job that starts at the same time as an accepted one', async () => {
      const date = addDays(phTodayStart(), 7);
      await seedBooking({ scheduledDate: date, scheduledTime: '13:00' });
      const clash = await seedBooking({ scheduledDate: date, scheduledTime: '13:00', status: 'PENDING' });
      const other = await seedBooking({ scheduledDate: date, scheduledTime: '14:00', status: 'PENDING' });

      const refused = await request(app).patch(`/api/bookings/${clash.id}/accept`).set('Authorization', `Bearer ${workerToken}`);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('START_TIME_CLASH');
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: clash.id } })).status).toBe('PENDING');

      // A different start time the same day is fine.
      const ok = await request(app).patch(`/api/bookings/${other.id}/accept`).set('Authorization', `Bearer ${workerToken}`);
      expect(ok.status).toBe(200);
    });

    it('lets only one of two same-start jobs be accepted when both are sent at once', async () => {
      const date = addDays(phTodayStart(), 8);
      const a = await seedBooking({ scheduledDate: date, scheduledTime: '16:00', status: 'PENDING' });
      const b = await seedBooking({ scheduledDate: date, scheduledTime: '16:00', status: 'PENDING' });

      const [ra, rb] = await Promise.all(
        [a, b].map((x) => request(app).patch(`/api/bookings/${x.id}/accept`).set('Authorization', `Bearer ${workerToken}`)),
      );

      expect([ra.status, rb.status].sort()).toEqual([200, 409]);
      const accepted = await prisma.booking.count({ where: { id: { in: [a.id, b.id] }, status: 'ACCEPTED' } });
      expect(accepted).toBe(1);
    });

    it('saves the weekly schedule as days of the week', async () => {
      const res = await request(app)
        .put('/api/workers/me/weekly-schedule')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ availableDays: [5, 1, 2, 3, 4, 1] });
      expect(res.status).toBe(200);
      expect(res.body.data.availableDays).toEqual([1, 2, 3, 4, 5]);
      await prisma.workerProfile.update({ where: { id: workerProfileId }, data: { availableDays: [0, 1, 2, 3, 4, 5, 6] } });
    });
  });

  describe('no-shows and cancelling after arriving', () => {
    it('cancels a no-show and charges the worker the penalty', async () => {
      const before = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });
      // Started over an hour ago (PH time), no check-in.
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000);
      const booking = await seedBooking({
        scheduledDate: new Date(Date.UTC(twoHoursAgo.getUTCFullYear(), twoHoursAgo.getUTCMonth(), twoHoursAgo.getUTCDate())),
        scheduledTime: `${String(twoHoursAgo.getUTCHours()).padStart(2, '0')}:00`,
      });

      await cancelWorkerNoShows();

      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { cancellation: true } });
      expect(after.status).toBe('CANCELLED');
      expect(after.cancellation).toMatchObject({ reason: 'WORKER_NO_SHOW', fault: 'WORKER', penaltyAmount: 200 });
      const profile = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });
      expect(profile.commissionOwed).toBeCloseTo(before.commissionOwed + 200, 2);
      await prisma.workerProfile.update({ where: { id: workerProfileId }, data: { commissionOwed: 0, debtHoldAt: null } });
    });

    it('needs proof and a fault to cancel after arriving; client fault goes to admin review', async () => {
      const booking = await seedBooking({ workerArrivedAt: new Date() });

      const noProof = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ reason: 'Nobody was home', workerCancellationReason: 'CLIENT_NO_SHOW' });
      expect(noProof.status).toBe(400);

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ reason: 'Client refused to let me in', fault: 'CLIENT', proofUrls: [photoUrl(workerId, 'gate')] });
      expect(res.status).toBe(200);
      expect(res.body.data.compensationStatus).toBe('PENDING_REVIEW');

      const queue = await request(app).get('/api/admin/cancellations').set('Authorization', `Bearer ${adminToken}`);
      expect(queue.body.data.map((c: { bookingId: string }) => c.bookingId)).toContain(booking.id);

      const review = await request(app)
        .patch(`/api/admin/cancellations/${booking.id}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ decision: 'APPROVE', note: 'Photo shows the locked gate at the booked time' });
      expect(review.status).toBe(200);

      const client = await prisma.clientProfile.findUniqueOrThrow({ where: { userId: clientId } });
      expect(client.paymentHoldAt).not.toBeNull();
      expect(client.outstandingBalance).toBe(200);
      const worker = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });
      expect(worker.compensationCredit).toBe(200);

      // Held clients can't book until it's settled.
      const blocked = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(isoDay(addDays(phTodayStart(), 7)), '09:00'));
      expect(blocked.status).toBe(402);

      await prisma.clientProfile.update({ where: { userId: clientId }, data: { paymentHoldAt: null, outstandingBalance: 0 } });
      await prisma.workerProfile.update({ where: { id: workerProfileId }, data: { compensationCredit: 0 } });
    });

    it('charges the penalty straight away when the worker admits fault', async () => {
      const booking = await seedBooking({ workerArrivedAt: new Date() });
      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ reason: 'Forgot the right tools for this job', fault: 'WORKER', proofUrls: [photoUrl(workerId, 'tools')] });
      expect(res.status).toBe(200);
      expect(res.body.data.penaltyAmount).toBe(200);
      const worker = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });
      expect(worker.commissionOwed).toBe(200);
      await prisma.workerProfile.update({ where: { id: workerProfileId }, data: { commissionOwed: 0, debtHoldAt: null } });
    });
  });

  describe('follow-ups', () => {
    it('lets the worker schedule a follow-up visit on an ongoing job', async () => {
      const booking = await seedBooking({ status: 'IN_PROGRESS', workerArrivedAt: new Date() });
      const date = isoDay(addDays(phTodayStart(), 2));
      const res = await request(app)
        .post(`/api/bookings/${booking.id}/visits`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ date, time: '09:00', notes: 'Paint needs to dry overnight' });
      expect(res.status).toBe(201);

      const calendar = await request(app)
        .get(`/api/workers/me/calendar?from=${date}&to=${date}`)
        .set('Authorization', `Bearer ${workerToken}`);
      expect(calendar.body.data.days[0].jobs).toEqual(
        expect.arrayContaining([expect.objectContaining({ bookingId: booking.id, kind: 'VISIT', time: '09:00' })])
      );
    });

    it('allows a follow-up job after an inspection, with a confirmed accept', async () => {
      await prisma.serviceTask.update({ where: { id: serviceTaskId }, data: { allowsFollowUp: true } });
      const inspection = await seedBooking({ status: 'COMPLETED' });

      const followUp = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(isoDay(addDays(phTodayStart(), 8)), '09:00', { parentBookingId: inspection.id }));
      expect(followUp.status).toBe(201);
      expect(followUp.body.data.parentBookingId).toBe(inspection.id);

      const unconfirmed = await request(app)
        .patch(`/api/bookings/${followUp.body.data.id}/accept`)
        .set('Authorization', `Bearer ${workerToken}`);
      expect(unconfirmed.status).toBe(400);
      expect(unconfirmed.body.code).toBe('FOLLOW_UP_CONFIRMATION_REQUIRED');

      const accepted = await request(app)
        .patch(`/api/bookings/${followUp.body.data.id}/accept`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ confirmFollowUp: true });
      expect(accepted.status).toBe(200);

      await prisma.serviceTask.update({ where: { id: serviceTaskId }, data: { allowsFollowUp: false } });
      const notInspection = await seedBooking({ status: 'COMPLETED' });
      const refused = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingBody(isoDay(addDays(phTodayStart(), 8)), '10:00', { parentBookingId: notInspection.id }));
      expect(refused.status).toBe(409);
    });
  });

  describe('reschedule requests', () => {
    it('lets a worker propose a new time and the client accept it', async () => {
      const booking = await seedBooking({});
      const date = isoDay(addDays(phTodayStart(), 9));
      const ask = await request(app)
        .patch(`/api/bookings/${booking.id}/request-reschedule`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ date, time: '14:00' });
      expect(ask.status).toBe(200);

      // The side that asked can't answer its own request.
      const selfAnswer = await request(app)
        .patch(`/api/bookings/${booking.id}/reschedule-request/respond`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ accept: true });
      expect(selfAnswer.status).toBe(403);

      const answer = await request(app)
        .patch(`/api/bookings/${booking.id}/reschedule-request/respond`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ accept: true });
      expect(answer.status).toBe(200);
      const moved = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(isoDay(moved.scheduledDate)).toBe(date);
      expect(moved.scheduledTime).toBe('14:00');
    });

    const askAs = (token: string, bookingId: string, date: string, time = '14:00') =>
      request(app)
        .patch(`/api/bookings/${bookingId}/request-reschedule`)
        .set('Authorization', `Bearer ${token}`)
        .send({ date, time });
    const respondAs = (token: string, bookingId: string, accept: boolean) =>
      request(app)
        .patch(`/api/bookings/${bookingId}/reschedule-request/respond`)
        .set('Authorization', `Bearer ${token}`)
        .send({ accept });
    const withdrawAs = (token: string, bookingId: string) =>
      request(app).patch(`/api/bookings/${bookingId}/reschedule-request/withdraw`).set('Authorization', `Bearer ${token}`);

    it('refuses a request from either side once the worker has arrived', async () => {
      const booking = await seedBooking({ workerArrivedAt: new Date() });
      const date = isoDay(addDays(phTodayStart(), 9));

      expect((await askAs(clientToken, booking.id, date)).status).toBe(409);
      expect((await askAs(workerToken, booking.id, date)).status).toBe(409);
    });

    it('refuses a second request while one is still open', async () => {
      const booking = await seedBooking({});
      const date = isoDay(addDays(phTodayStart(), 9));

      expect((await askAs(workerToken, booking.id, date)).status).toBe(200);
      expect((await askAs(clientToken, booking.id, date, '15:00')).status).toBe(409);
      const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(row.rescheduleRequestedBy).toBe('WORKER');
      expect(row.requestedScheduledTime).toBe('14:00');
    });

    it("won't accept a proposal whose time has already passed, and leaves the booking alone", async () => {
      const yesterday = addDays(phTodayStart(), -1);
      const booking = await seedBooking({
        rescheduleRequestedBy: 'WORKER',
        rescheduleRequestedAt: new Date(),
        requestedScheduledDate: yesterday,
        requestedScheduledTime: '10:00',
      });

      const res = await respondAs(clientToken, booking.id, true);
      expect(res.status).toBe(409);

      const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(isoDay(row.scheduledDate)).toBe(isoDay(booking.scheduledDate));
      expect(row.scheduledTime).toBe('09:00');
      // Still open, so the client can decline it.
      expect(row.rescheduleRequestRespondedAt).toBeNull();
      expect((await respondAs(clientToken, booking.id, false)).status).toBe(200);
    });

    it("won't accept a proposal once the worker has arrived", async () => {
      const booking = await seedBooking({
        workerArrivedAt: new Date(),
        rescheduleRequestedBy: 'WORKER',
        rescheduleRequestedAt: new Date(),
        requestedScheduledDate: addDays(phTodayStart(), 9),
        requestedScheduledTime: '14:00',
      });

      expect((await respondAs(clientToken, booking.id, true)).status).toBe(409);
      const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(row.scheduledTime).toBe('09:00');
    });

    it('does not move the booking if the worker arrives while the client is accepting', async () => {
      const booking = await seedBooking({
        rescheduleRequestedBy: 'WORKER',
        rescheduleRequestedAt: new Date(),
        requestedScheduledDate: addDays(phTodayStart(), 9),
        requestedScheduledTime: '14:00',
      });

      const [answer] = await Promise.all([
        respondAs(clientToken, booking.id, true),
        prisma.booking.update({ where: { id: booking.id }, data: { workerArrivedAt: new Date() } }),
      ]);

      const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      // Either the accept won (moved before the arrival) or it was refused —
      // but never both "moved" and "arrived".
      if (answer.status === 200) {
        expect(row.scheduledTime).toBe('14:00');
      } else {
        expect(answer.status).toBe(409);
        expect(row.scheduledTime).toBe('09:00');
      }
    });

    it("won't accept a proposal onto the start time of another job the pro already has", async () => {
      const day = addDays(phTodayStart(), 20);
      await seedBooking({ scheduledDate: day, scheduledTime: '14:00' });
      const booking = await seedBooking({
        rescheduleRequestedBy: 'WORKER',
        rescheduleRequestedAt: new Date(),
        requestedScheduledDate: day,
        requestedScheduledTime: '14:00',
      });

      const res = await respondAs(clientToken, booking.id, true);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('START_TIME_CLASH');

      const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(row.scheduledTime).toBe('09:00');
      // Still open, so it can be declined.
      expect(row.rescheduleRequestRespondedAt).toBeNull();
      expect((await respondAs(clientToken, booking.id, false)).status).toBe(200);
    });

    it('lets a proposal through when the other job starts at a different time', async () => {
      const day = addDays(phTodayStart(), 21);
      await seedBooking({ scheduledDate: day, scheduledTime: '13:00' });
      const booking = await seedBooking({
        rescheduleRequestedBy: 'WORKER',
        rescheduleRequestedAt: new Date(),
        requestedScheduledDate: day,
        requestedScheduledTime: '14:00',
      });

      expect((await respondAs(clientToken, booking.id, true)).status).toBe(200);
      const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(row.scheduledTime).toBe('14:00');
    });

    it('lets only the requester withdraw, tells the other side, and only once', async () => {
      const booking = await seedBooking({});
      const date = isoDay(addDays(phTodayStart(), 9));
      expect((await askAs(workerToken, booking.id, date)).status).toBe(200);

      expect((await withdrawAs(clientToken, booking.id)).status).toBe(403);
      expect((await withdrawAs(workerToken, booking.id)).status).toBe(200);

      const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(row.rescheduleRequestRespondedAt).not.toBeNull();
      expect(row.rescheduleRequestAccepted).toBeNull();
      expect(
        await prisma.notification.count({
          where: { userId: clientId, relatedId: booking.id, title: 'Reschedule Request Withdrawn' },
        })
      ).toBe(1);

      expect((await withdrawAs(workerToken, booking.id)).status).toBe(409);
    });
  });

  describe('account safety', () => {
    it('counts signed-in devices and logs out the others', async () => {
      const first = await login(clientEmail);
      const second = await login(clientEmail);
      const sessions = await request(app).get('/api/users/me/sessions').set('Authorization', `Bearer ${first.body.data.token}`);
      expect(sessions.body.data.activeSessions).toBeGreaterThanOrEqual(2);

      const out = await request(app).post('/api/users/me/logout-all').set('Authorization', `Bearer ${first.body.data.token}`);
      expect(out.status).toBe(200);
      expect(out.body.data.signedOutCurrent).toBe(false);

      // The other device can no longer refresh; this one can.
      const otherRefresh = await request(app).post('/api/auth/refresh').send({ refreshToken: second.body.data.refreshToken });
      expect(otherRefresh.status).toBe(401);
      const thisRefresh = await request(app).post('/api/auth/refresh').send({ refreshToken: first.body.data.refreshToken });
      expect(thisRefresh.status).toBe(200);
      const after = await request(app).get('/api/users/me/sessions').set('Authorization', `Bearer ${thisRefresh.body.data.token}`);
      expect(after.body.data.activeSessions).toBe(1);
    });

    it('lets a worker deactivate (hidden from search) and reactivate', async () => {
      const worker = await createTestUser('ops-deactivate', { role: 'WORKER' });
      createdUserIds.push(worker.user.id);
      const token = (await login(worker.user.email)).body.data.token;

      const wrongPw = await request(app)
        .post('/api/users/me/deactivate')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'nope' });
      expect(wrongPw.status).toBe(401);

      const res = await request(app)
        .post('/api/users/me/deactivate')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: PASSWORD, reason: 'Taking a break' });
      expect(res.status).toBe(200);

      const blocked = await login(worker.user.email);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('ACCOUNT_DEACTIVATED');

      const reactivate = await request(app).post('/api/auth/reactivate').send({ email: worker.user.email, password: PASSWORD });
      expect(reactivate.status).toBe(200);
      expect((await login(worker.user.email)).status).toBe(200);
    });

    it('asks workers for a date of birth in the accepted range at signup', async () => {
      const base = { fullName: 'Ops Signup', phone: '09171230000', password: PASSWORD, role: 'WORKER' };
      const missing = await request(app).post('/api/auth/signup').send({ ...base, email: `e2etest.ops-dob1.${Date.now()}@homeease.invalid` });
      expect(missing.status).toBe(400);
      const tooOld = await request(app)
        .post('/api/auth/signup')
        .send({ ...base, email: `e2etest.ops-dob2.${Date.now()}@homeease.invalid`, birthDate: '1950-01-01' });
      expect(tooOld.status).toBe(400);
      const ok = await request(app)
        .post('/api/auth/signup')
        .send({ ...base, email: `e2etest.ops-dob3.${Date.now()}@homeease.invalid`, birthDate: '1995-06-01' });
      expect(ok.status).toBe(201);
      createdUserIds.push(ok.body.data.id);
    });
  });
});
