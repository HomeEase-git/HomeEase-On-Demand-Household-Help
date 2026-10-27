import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { invalidateAppSettingsCache } from '@services/appSettingsService';
import { BOOKING_PHOTO_BUCKET } from '@config/supabase';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

// Manila coordinates, mirroring tests/unit/geo.test.ts's known-good deltas:
// ~55m away is inside the default 100m geofence, ~1.2km away is outside it.
const CLIENT_LOCATION = { lat: 14.5995, lng: 120.9842 };
const NEARBY_WORKER_LOCATION = { lat: 14.5995 + 0.0005, lng: 120.9842 };
const FAR_WORKER_LOCATION = { lat: 14.61, lng: 120.9842 };

describe('Booking flow — arrival geofencing, the invoice after the job, dispute resolution', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientToken: string;
  let clientId: string;
  let workerToken: string;
  let workerId: string;
  let adminToken: string;

  beforeAll(async () => {
    const { user: client, plainPassword: clientPw } = await createTestUser('booking-flow-client', { role: 'CLIENT' });
    const { user: worker, plainPassword: workerPw } = await createTestUser('booking-flow-worker', { role: 'WORKER' });
    const { user: admin, plainPassword: adminPw } = await createTestUser('booking-flow-admin', { role: 'ADMIN' });
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
    for (const id of createdBookingIds) {
      await deleteTestBooking(id);
    }
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  describe('arrival geofencing', () => {
    it('rejects check-in when the worker is outside the geofence radius', async () => {
      // The radius is an admin setting (0 turns the check off), so pin it here
      // instead of relying on whatever the database currently holds.
      const settings = await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
      await prisma.appSettings.update({ where: { id: 'singleton' }, data: { geofenceRadiusMeters: 150 } });
      invalidateAppSettingsCache();
      try {
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
          .send({ lat: FAR_WORKER_LOCATION.lat, lng: FAR_WORKER_LOCATION.lng });

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/must be within/i);

        const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
        expect(dbBooking?.workerArrivedAt).toBeNull();
      } finally {
        await prisma.appSettings.update({ where: { id: 'singleton' }, data: { geofenceRadiusMeters: settings.geofenceRadiusMeters } });
        invalidateAppSettingsCache();
      }
    });

    it('accepts check-in when the worker is within the geofence radius', async () => {
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
        .send({ lat: NEARBY_WORKER_LOCATION.lat, lng: NEARBY_WORKER_LOCATION.lng });

      expect(res.status).toBe(200);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking?.workerArrivedAt).not.toBeNull();

      const verification = await prisma.arrivalVerification.findUnique({ where: { bookingId: booking.id } });
      expect(verification?.isVerified).toBe(true);
    });

    it('skips the distance check when geofenceRadiusMeters is 0', async () => {
      const settings = await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
      await prisma.appSettings.update({ where: { id: 'singleton' }, data: { geofenceRadiusMeters: 0 } });
      invalidateAppSettingsCache();
      try {
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
          .send({ lat: FAR_WORKER_LOCATION.lat, lng: FAR_WORKER_LOCATION.lng });

        expect(res.status).toBe(200);
      } finally {
        await prisma.appSettings.update({ where: { id: 'singleton' }, data: { geofenceRadiusMeters: settings.geofenceRadiusMeters } });
        invalidateAppSettingsCache();
      }
    });

    it('rejects check-in when the reported GPS accuracy radius is too imprecise, even inside the geofence', async () => {
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
        .send({ lat: NEARBY_WORKER_LOCATION.lat, lng: NEARBY_WORKER_LOCATION.lng, accuracy: 500 });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/imprecise/i);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking?.workerArrivedAt).toBeNull();
    });

    it('accepts check-in when reported GPS accuracy is within the sanity bound', async () => {
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
        .send({ lat: NEARBY_WORKER_LOCATION.lat, lng: NEARBY_WORKER_LOCATION.lng, accuracy: 15 });

      expect(res.status).toBe(200);
    });

    it('rejects check-in when the client reports a mock-location provider, even inside the geofence', async () => {
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
        .send({ lat: NEARBY_WORKER_LOCATION.lat, lng: NEARBY_WORKER_LOCATION.lng, mocked: true });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/mock location/i);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking?.workerArrivedAt).toBeNull();
    });

    it('rejects check-in from a worker the booking is not assigned to', async () => {
      const booking = await createTestBooking({
        clientId,
        workerId,
        status: 'ACCEPTED',
        clientLat: CLIENT_LOCATION.lat,
        clientLng: CLIENT_LOCATION.lng,
      });
      createdBookingIds.push(booking.id);

      const { user: otherWorker, plainPassword } = await createTestUser('booking-flow-other-worker', { role: 'WORKER' });
      createdUserIds.push(otherWorker.id);
      const login = await request(app).post('/api/auth/login').send({ email: otherWorker.email, password: plainPassword });

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/arrive`)
        .set('Authorization', `Bearer ${login.body.data.token}`)
        .send({ lat: NEARBY_WORKER_LOCATION.lat, lng: NEARBY_WORKER_LOCATION.lng });

      expect(res.status).toBe(403);
    });
  });

  describe('starting the job', () => {
    const photo = (owner: string, name: string) =>
      `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/${owner}/${name}.jpg`;

    it('needs a before photo to start the job', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);
      const start = (body: Record<string, unknown>) =>
        request(app).patch(`/api/bookings/${booking.id}/start`).set('Authorization', `Bearer ${workerToken}`).send(body);

      expect((await start({})).status).toBe(400);
      expect((await start({ beforePhotoUrls: [photo(clientId, 'x')] })).status).toBe(400);
      expect((await start({ beforePhotoUrls: [photo(workerId, 'before')] })).status).toBe(200);
      const db = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(db?.status).toBe('IN_PROGRESS');
      expect(db?.beforePhotoUrls).toHaveLength(1);
    });

    it('needs the worker to have checked in', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED' });
      createdBookingIds.push(booking.id);

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/start`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ beforePhotoUrls: [photo(workerId, 'before')] });

      expect(res.status).toBe(409);
    });

    it('starts at the booked price, with no quote step', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/start`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ beforePhotoUrls: [photo(workerId, 'before')] });

      expect(res.status).toBe(200);
      const quote = await request(app).post(`/api/bookings/${booking.id}/quote`).set('Authorization', `Bearer ${workerToken}`).send({ items: [] });
      expect(quote.status).toBe(404);
    });
  });

  describe('the invoice after the job', () => {
    const photo = (owner: string, name: string) =>
      `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/${owner}/${name}.jpg`;
    const started = async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS', estimatedPrice: 1000 });
      createdBookingIds.push(booking.id);
      await prisma.booking.update({ where: { id: booking.id }, data: { progressPhotoUrls: [photo(workerId, 'midway')] } });
      return booking;
    };
    const complete = (id: string, body: Record<string, unknown>) =>
      request(app).patch(`/api/bookings/${id}/complete`).set('Authorization', `Bearer ${workerToken}`).send(body);
    // Built in beforeAll: workerId isn't set yet when this describe body runs.
    let done: string;
    let part: Record<string, unknown>;
    let extra: Record<string, unknown>;
    beforeAll(() => {
      done = photo(workerId, 'after');
      part = { kind: 'PART', name: 'Outlet cover', price: 120, photoUrls: [photo(workerId, 'receipt')] };
      extra = { kind: 'EXTRA_WORK', name: 'Second outlet', price: 300, photoUrls: [photo(workerId, 'extra')] };
    });

    it('cannot complete a job that has not been started', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);

      expect((await complete(booking.id, { completionPhotoUrl: done })).status).toBe(409);
    });

    it("rejects a completion photo that is not the worker's own booking photo", async () => {
      const booking = await started();

      expect((await complete(booking.id, { completionPhotoUrl: photo(clientId, 'x') })).status).toBe(400);
      expect((await complete(booking.id, { completionPhotoUrl: 'https://example.com/x.jpg' })).status).toBe(400);
      const db = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(db?.status).toBe('IN_PROGRESS');
    });

    it('needs a progress photo before the job can be marked done', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS' });
      createdBookingIds.push(booking.id);

      expect((await complete(booking.id, { completionPhotoUrl: done })).status).toBe(409);
    });

    it('sends a cash invoice with parts and extra work, and waits for Cash received', async () => {
      const booking = await started();

      const res = await complete(booking.id, { completionPhotoUrl: done, items: [part, extra] });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PENDING_COMPLETION');
      expect(res.body.data.total).toBe(1420);
      const db = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(db.status).toBe('PENDING_COMPLETION');
      expect(db.finalPrice).toBe(1420);
      const lines = await prisma.bookingAddOn.findMany({ where: { bookingId: booking.id }, orderBy: { price: 'asc' } });
      expect(lines.map((l) => [l.kind, l.price, l.clientApprovedAt != null])).toEqual([
        ['PART', 120, true],
        ['EXTRA_WORK', 300, true],
      ]);

      const detail = await request(app).get(`/api/bookings/${booking.id}`).set('Authorization', `Bearer ${clientToken}`);
      expect(detail.body.data.invoice).toMatchObject({ status: 'DUE', subtotal: 1420, total: 1420 });
      expect(detail.body.data.invoice.lines.map((l: { kind: string }) => l.kind)).toEqual(['JOB', 'PART', 'EXTRA_WORK']);
    });

    it('refuses a part without a receipt photo, or with photos that are not the worker\'s', async () => {
      const booking = await started();

      const noReceipt = await complete(booking.id, { completionPhotoUrl: done, items: [{ ...part, photoUrls: [] }] });
      expect(noReceipt.status).toBe(400);
      expect(noReceipt.body.message).toMatch(/receipt/);
      const foreign = await complete(booking.id, { completionPhotoUrl: done, items: [{ ...part, photoUrls: [photo(clientId, 'r')] }] });
      expect(foreign.status).toBe(400);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('IN_PROGRESS');
    });

    it('settles a cash invoice when the worker taps Cash received', async () => {
      const booking = await started();
      await complete(booking.id, { completionPhotoUrl: done, items: [part] });

      const res = await request(app).patch(`/api/bookings/${booking.id}/cash-received`).set('Authorization', `Bearer ${workerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.payment.totalAmount).toBe(1120);
      const db = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(db.status).toBe('COMPLETED');
    });

    it('does not let the client confirm a cash invoice', async () => {
      const booking = await started();
      await complete(booking.id, { completionPhotoUrl: done });

      const res = await request(app).patch(`/api/bookings/${booking.id}/confirm-completion`).set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(409);
    });

    it('lets the client report the invoice before paying, and then blocks Cash received', async () => {
      const booking = await started();
      await complete(booking.id, { completionPhotoUrl: done, items: [extra] });

      const tooShort = await request(app)
        .patch(`/api/bookings/${booking.id}/invoice/report`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'wrong' });
      expect(tooShort.status).toBe(400);

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/invoice/report`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Only one outlet was installed, not two' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('DISPUTED');

      const cash = await request(app).patch(`/api/bookings/${booking.id}/cash-received`).set('Authorization', `Bearer ${workerToken}`);
      expect(cash.status).toBe(409);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('DISPUTED');
    });

    it('refuses a report before the invoice is sent', async () => {
      const booking = await started();

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/invoice/report`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'The worker is still working on it' });

      expect(res.status).toBe(409);
    });
  });

  describe('dispute resolution', () => {
    const photo = (owner: string, name: string) =>
      `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/${owner}/${name}.jpg`;

    // A cash job whose invoice (₱1000 job + ₱300 extra work) the client reported.
    async function seedReportedInvoice() {
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS', estimatedPrice: 1000 });
      createdBookingIds.push(booking.id);
      await prisma.booking.update({ where: { id: booking.id }, data: { progressPhotoUrls: [photo(workerId, 'midway')] } });

      const sent = await request(app)
        .patch(`/api/bookings/${booking.id}/complete`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({
          completionPhotoUrl: photo(workerId, 'after'),
          items: [{ kind: 'EXTRA_WORK', name: 'Second outlet', price: 300, photoUrls: [photo(workerId, 'extra')] }],
        });
      expect(sent.status).toBe(200);

      const reported = await request(app)
        .patch(`/api/bookings/${booking.id}/invoice/report`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Only one outlet was installed' });
      expect(reported.status).toBe(200);

      return { bookingId: booking.id, disputeId: reported.body.data.disputeId as string };
    }

    const resolve = (disputeId: string, body: Record<string, unknown>) =>
      request(app).patch(`/api/admin/disputes/${disputeId}/resolve`).set('Authorization', `Bearer ${adminToken}`).send(body);

    it('KEEP_INVOICE puts the invoice back as due, unchanged', async () => {
      const { bookingId, disputeId } = await seedReportedInvoice();

      const res = await resolve(disputeId, { action: 'KEEP_INVOICE', resolution: 'Photos show two outlets' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('RESOLVED_INVOICE_KEPT');
      const db = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(db.status).toBe('PENDING_COMPLETION');
      expect(db.finalPrice).toBe(1300);
    });

    it('REMOVE_INVOICE_EXTRAS takes the added lines off and recomputes the total', async () => {
      const { bookingId, disputeId } = await seedReportedInvoice();

      const res = await resolve(disputeId, { action: 'REMOVE_INVOICE_EXTRAS', resolution: 'Only one outlet in the photos' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('RESOLVED_INVOICE_ADJUSTED');
      const db = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(db.status).toBe('PENDING_COMPLETION');
      expect(db.finalPrice).toBe(1000);
      const extra = await prisma.bookingAddOn.findFirstOrThrow({ where: { bookingId, kind: 'EXTRA_WORK' } });
      expect(extra.clientApprovedAt).toBeNull();
      expect(extra.clientRejectedAt).not.toBeNull();

      const cash = await request(app).patch(`/api/bookings/${bookingId}/cash-received`).set('Authorization', `Bearer ${workerToken}`);
      expect(cash.status).toBe(200);
      expect(cash.body.data.payment.totalAmount).toBe(1000);
    });

    it('CANCEL_BOOKING cancels the booking and records a Cancellation', async () => {
      const { bookingId, disputeId } = await seedReportedInvoice();

      const res = await resolve(disputeId, { action: 'CANCEL_BOOKING', resolution: 'Client and worker could not reach agreement' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('RESOLVED_CANCELLED');
      const dbBooking = await prisma.booking.findUnique({ where: { id: bookingId } });
      expect(dbBooking?.status).toBe('CANCELLED');
      const cancellation = await prisma.cancellation.findUnique({ where: { bookingId } });
      expect(cancellation?.cancelledBy).toBe('ADMIN');
    });

    it('rejects the retired quote actions and unknown ones', async () => {
      const { disputeId } = await seedReportedInvoice();

      expect((await resolve(disputeId, { action: 'APPROVE_QUOTE' })).status).toBe(400);
      expect((await resolve(disputeId, { action: 'NOT_A_REAL_ACTION' })).status).toBe(400);
    });

    it('rejects resolving an already-resolved dispute', async () => {
      const { disputeId } = await seedReportedInvoice();

      expect((await resolve(disputeId, { action: 'CANCEL_BOOKING', resolution: 'First resolution' })).status).toBe(200);
      expect((await resolve(disputeId, { action: 'CANCEL_BOOKING', resolution: 'Second attempt' })).status).toBe(409);
    });
  });
});
