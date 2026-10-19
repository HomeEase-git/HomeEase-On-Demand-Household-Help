import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { invalidateAppSettingsCache } from '@services/appSettingsService';
import { BOOKING_PHOTO_BUCKET } from '@config/supabase';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';
import { remindPendingAddons } from '@/workers/bookingWorker';

// Manila coordinates, mirroring tests/unit/geo.test.ts's known-good deltas:
// ~55m away is inside the default 100m geofence, ~1.2km away is outside it.
const CLIENT_LOCATION = { lat: 14.5995, lng: 120.9842 };
const NEARBY_WORKER_LOCATION = { lat: 14.5995 + 0.0005, lng: 120.9842 };
const FAR_WORKER_LOCATION = { lat: 14.61, lng: 120.9842 };

describe('Booking flow — arrival geofencing, quote submission, dispute resolution', () => {
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

  describe('quote submission', () => {
    const photo = (name: string) =>
      `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/${workerId}/${name}.jpg`;
    const quoteItem = (over: Record<string, unknown> = {}) => ({
      name: 'Cleaning supplies',
      price: 300,
      receiptUrls: [photo('receipt')],
      proofOfUseUrls: [photo('in-use')],
      ...over,
    });
    const submit = (bookingId: string, body: Record<string, unknown>, token = workerToken) =>
      request(app).post(`/api/bookings/${bookingId}/quote`).set('Authorization', `Bearer ${token}`).send(body);

    it('rejects a quote submitted before the worker has arrived', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED' });
      createdBookingIds.push(booking.id);

      const res = await submit(booking.id, { items: [quoteItem()], notes: 'Extra materials needed' });

      expect(res.status).toBe(409);
    });

    it('rejects a quote once the job has started', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);

      expect((await submit(booking.id, { items: [quoteItem()] })).status).toBe(409);
    });

    it('pins laborCost to the settled estimate, sums the items and moves the booking to QUOTE_SUBMITTED', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date(), estimatedPrice: 1500 });
      createdBookingIds.push(booking.id);

      const res = await submit(booking.id, { items: [quoteItem()], notes: 'Extra cleaning supplies' });

      expect(res.status).toBe(201);
      expect(res.body.data.laborCost).toBe(1500);
      expect(res.body.data.materialsCost).toBe(300);
      expect(res.body.data.totalCost).toBe(1800);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking?.status).toBe('QUOTE_SUBMITTED');
      expect(dbBooking?.quoteStatus).toBe('SUBMITTED');
      expect(await prisma.bookingQuoteItem.count({ where: { bookingId: booking.id } })).toBe(1);
    });

    it('accepts a labor-only quote with no items', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date(), estimatedPrice: 1500 });
      createdBookingIds.push(booking.id);

      const res = await submit(booking.id, { items: [] });

      expect(res.status).toBe(201);
      expect(res.body.data.materialsCost).toBe(0);
    });

    it('rejects an item that has no photo of the receipt', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);

      const res = await submit(booking.id, { items: [quoteItem({ receiptUrls: [] })] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/receipt/i);
      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking?.status).toBe('ACCEPTED');
    });

    it('accepts an item without an in-use photo (the job has not started yet)', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);

      expect((await submit(booking.id, { items: [quoteItem({ proofOfUseUrls: [] })] })).status).toBe(201);
    });

    it('rejects photos that belong to another worker', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);
      const foreign = `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/someone-else/x.jpg`;

      const res = await submit(booking.id, { items: [quoteItem({ receiptUrls: [foreign] })] });

      expect(res.status).toBe(400);
    });

    it('replaces the previous items when the quote is resubmitted', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date(), estimatedPrice: 1000 });
      createdBookingIds.push(booking.id);
      await submit(booking.id, { items: [quoteItem({ name: 'Old', price: 100 }), quoteItem({ name: 'Old 2', price: 50 })] });
      await prisma.booking.update({ where: { id: booking.id }, data: { status: 'ACCEPTED', quoteStatus: 'REJECTED' } });

      const res = await submit(booking.id, { items: [quoteItem({ name: 'New', price: 75 })] });

      expect(res.status).toBe(201);
      expect(res.body.data.materialsCost).toBe(75);
      const rows = await prisma.bookingQuoteItem.findMany({ where: { bookingId: booking.id } });
      expect(rows.map((r) => r.name)).toEqual(['New']);
    });

    it('rejects a quote submitted by a client', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED', workerArrivedAt: new Date() });
      createdBookingIds.push(booking.id);

      const res = await submit(booking.id, { items: [] }, clientToken);

      expect(res.status).toBe(403);
    });
  });

  describe('editing a submitted quote', () => {
    const photo = (name: string) =>
      `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/${workerId}/${name}.jpg`;
    const withQuote = async (status: 'QUOTE_SUBMITTED' | 'QUOTE_APPROVED' | 'PENDING_COMPLETION') => {
      const booking = await createTestBooking({ clientId, workerId, status, estimatedPrice: 1000 });
      createdBookingIds.push(booking.id);
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          laborCost: 1000,
          materialsCost: 200,
          quoteStatus: status === 'QUOTE_SUBMITTED' ? 'SUBMITTED' : 'APPROVED',
          finalPrice: status === 'QUOTE_SUBMITTED' ? null : 1200,
          approvedAt: status === 'QUOTE_SUBMITTED' ? null : new Date(),
        },
      });
      await prisma.bookingQuoteItem.create({
        data: { bookingId: booking.id, name: 'Pipe', price: 200, receiptUrls: [photo('r')], proofOfUseUrls: [photo('u')] },
      });
      return booking;
    };
    const reopen = (id: string, token = workerToken) =>
      request(app).post(`/api/bookings/${id}/quote/reopen`).set('Authorization', `Bearer ${token}`);

    it('returns the items in the booking detail', async () => {
      const booking = await withQuote('QUOTE_SUBMITTED');

      const res = await request(app).get(`/api/bookings/${booking.id}`).set('Authorization', `Bearer ${workerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.quote.items).toHaveLength(1);
      expect(res.body.data.quote.items[0]).toMatchObject({ name: 'Pipe', price: 200 });
    });

    it('reopens a submitted quote for editing and keeps its items', async () => {
      const booking = await withQuote('QUOTE_SUBMITTED');

      const res = await reopen(booking.id);

      expect(res.status).toBe(200);
      const db = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(db?.status).toBe('ACCEPTED');
      expect(db?.quoteStatus).toBeNull();
      expect(await prisma.bookingQuoteItem.count({ where: { bookingId: booking.id } })).toBe(1);
    });

    it('reopens an approved quote and clears the approval and final price', async () => {
      const booking = await withQuote('QUOTE_APPROVED');

      const res = await reopen(booking.id);

      expect(res.status).toBe(200);
      const db = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(db?.status).toBe('ACCEPTED');
      expect(db?.finalPrice).toBeNull();
      expect(db?.approvedAt).toBeNull();
      expect(db?.quoteRevision).toBe(1);
    });

    it('refuses to reopen once the job has started', async () => {
      const booking = await withQuote('PENDING_COMPLETION');
      await prisma.booking.update({ where: { id: booking.id }, data: { status: 'IN_PROGRESS' } });

      expect((await reopen(booking.id)).status).toBe(409);
    });

    it('refuses a worker who is not assigned', async () => {
      const booking = await withQuote('QUOTE_SUBMITTED');
      const { user: other, plainPassword } = await createTestUser('booking-flow-reopen-other', { role: 'WORKER' });
      createdUserIds.push(other.id);
      const login = await request(app).post('/api/auth/login').send({ email: other.email, password: plainPassword });

      expect((await reopen(booking.id, login.body.data.token)).status).toBe(403);
    });
  });

  describe('approving and completing', () => {
    const photo = (owner: string, name: string) =>
      `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOKING_PHOTO_BUCKET}/${owner}/${name}.jpg`;
    const approve = (id: string, body: Record<string, unknown>) =>
      request(app).patch(`/api/bookings/${id}/quote/approve`).set('Authorization', `Bearer ${clientToken}`).send(body);

    const submitted = async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'QUOTE_SUBMITTED', estimatedPrice: 1000 });
      createdBookingIds.push(booking.id);
      return prisma.booking.update({
        where: { id: booking.id },
        data: { laborCost: 1000, materialsCost: 0, quoteStatus: 'SUBMITTED', quotedAt: new Date(), quoteRevision: 2 },
      });
    };

    it('refuses an approval that names no revision', async () => {
      const booking = await submitted();

      expect((await approve(booking.id, {})).status).toBe(400);
    });

    it('refuses an approval of a revision the client did not see', async () => {
      const booking = await submitted();

      const res = await approve(booking.id, { revision: 1 });

      expect(res.status).toBe(409);
      const db = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(db?.status).toBe('QUOTE_SUBMITTED');
    });

    it('approves the revision the client viewed', async () => {
      const booking = await submitted();

      const res = await approve(booking.id, { revision: 2 });

      expect(res.status).toBe(200);
      const db = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(db?.status).toBe('QUOTE_APPROVED');
      expect(db?.finalPrice).toBe(1000);
    });

    it('cannot complete a job that has not been started', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'QUOTE_APPROVED' });
      createdBookingIds.push(booking.id);

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/complete`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ completionPhotoUrl: photo(workerId, 'done') });

      expect(res.status).toBe(409);
      const db = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(db?.status).toBe('QUOTE_APPROVED');
    });

    it("rejects a completion photo that is not the worker's own booking photo", async () => {
      // IN_PROGRESS: the job is started (after the client approved the quote).
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS' });
      createdBookingIds.push(booking.id);
      const complete = (url: string) =>
        request(app)
          .patch(`/api/bookings/${booking.id}/complete`)
          .set('Authorization', `Bearer ${workerToken}`)
          .send({ completionPhotoUrl: url });

      expect((await complete(photo(clientId, 'x'))).status).toBe(400);
      expect((await complete('https://example.com/x.jpg')).status).toBe(400);
      const db = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(db?.status).toBe('IN_PROGRESS');
    });

    it('needs a before photo to start the job', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'QUOTE_APPROVED', workerArrivedAt: new Date() });
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

    it('needs a progress photo before the job can be marked done', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS' });
      createdBookingIds.push(booking.id);
      const complete = () =>
        request(app)
          .patch(`/api/bookings/${booking.id}/complete`)
          .set('Authorization', `Bearer ${workerToken}`)
          .send({ completionPhotoUrl: photo(workerId, 'after') });

      expect((await complete()).status).toBe(409);

      const progress = await request(app)
        .post(`/api/bookings/${booking.id}/progress-photos`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ photoUrls: [photo(workerId, 'midway')] });
      expect(progress.status).toBe(201);

      expect((await complete()).status).toBe(200);
      const db = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(db?.status).toBe('PENDING_COMPLETION');
    });
  });

  describe('extra work on the same visit', () => {
    const addExtra = (id: string) =>
      request(app)
        .post(`/api/bookings/${id}/addons`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ name: 'Faucet repair', price: 1500 });

    it('worker adds a pending extra only once on site', async () => {
      const pending = await createTestBooking({ clientId, workerId, status: 'PENDING' });
      const working = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS' });
      createdBookingIds.push(pending.id, working.id);

      expect((await addExtra(pending.id)).status).toBe(409);
      const res = await addExtra(working.id);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ price: 1500, clientApprovedAt: null });
    });

    it('client can ask for extra work', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS' });
      createdBookingIds.push(booking.id);
      const res = await request(app)
        .post(`/api/bookings/${booking.id}/addons/request`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ description: 'Please also fix the leaking faucet' });
      expect(res.status).toBe(200);
    });

    it('never auto-approves an extra the client has not answered', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS' });
      createdBookingIds.push(booking.id);
      const addon = await prisma.bookingAddOn.create({
        data: { bookingId: booking.id, name: 'Old extra', price: 300, createdAt: new Date(Date.now() - 24 * 3600 * 1000) },
      });

      await remindPendingAddons();

      const db = await prisma.bookingAddOn.findUniqueOrThrow({ where: { id: addon.id } });
      expect(db.clientApprovedAt).toBeNull();
      expect(db.reminderSentAt).not.toBeNull();
    });
  });

  describe('dispute resolution', () => {
    async function seedDisputedBooking() {
      const booking = await createTestBooking({
        clientId,
        workerId,
        status: 'QUOTE_SUBMITTED',
        estimatedPrice: 1000,
      });
      createdBookingIds.push(booking.id);

      await prisma.booking.update({
        where: { id: booking.id },
        data: { laborCost: 1000, materialsCost: 250, quoteStatus: 'SUBMITTED', quotedAt: new Date() },
      });

      const disputeRes = await request(app)
        .patch(`/api/bookings/${booking.id}/quote/dispute`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Materials cost seems too high' });

      expect(disputeRes.status).toBe(200);
      expect(disputeRes.body.data.status).toBe('DISPUTED');

      return { bookingId: booking.id, disputeId: disputeRes.body.data.disputeId as string };
    }

    it('APPROVE_QUOTE moves the booking to QUOTE_APPROVED at the disputed price', async () => {
      const { bookingId, disputeId } = await seedDisputedBooking();

      const res = await request(app)
        .patch(`/api/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'APPROVE_QUOTE', resolution: 'Materials cost is justified per receipts provided' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('RESOLVED_APPROVED');

      const dbBooking = await prisma.booking.findUnique({ where: { id: bookingId } });
      expect(dbBooking?.status).toBe('QUOTE_APPROVED');
      expect(dbBooking?.finalPrice).toBe(1250);
    });

    it('REQUEST_NEW_QUOTE sends the booking back to ACCEPTED (to re-quote) and clears the quote', async () => {
      const { bookingId, disputeId } = await seedDisputedBooking();

      const res = await request(app)
        .patch(`/api/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'REQUEST_NEW_QUOTE', resolution: 'Please itemize the materials cost' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('RESOLVED_NEW_QUOTE_REQUESTED');

      const dbBooking = await prisma.booking.findUnique({ where: { id: bookingId } });
      expect(dbBooking?.status).toBe('ACCEPTED');
      expect(dbBooking?.laborCost).toBeNull();
      expect(dbBooking?.materialsCost).toBeNull();
    });

    it('CANCEL_BOOKING cancels the booking and records a Cancellation', async () => {
      const { bookingId, disputeId } = await seedDisputedBooking();

      const res = await request(app)
        .patch(`/api/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'CANCEL_BOOKING', resolution: 'Client and worker could not reach agreement' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('RESOLVED_CANCELLED');

      const dbBooking = await prisma.booking.findUnique({ where: { id: bookingId } });
      expect(dbBooking?.status).toBe('CANCELLED');

      const cancellation = await prisma.cancellation.findUnique({ where: { bookingId } });
      expect(cancellation?.cancelledBy).toBe('ADMIN');
    });

    it('rejects an unrecognized resolution action', async () => {
      const { disputeId } = await seedDisputedBooking();

      const res = await request(app)
        .patch(`/api/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NOT_A_REAL_ACTION' });

      expect(res.status).toBe(400);
    });

    it('rejects resolving an already-resolved dispute', async () => {
      const { disputeId } = await seedDisputedBooking();

      const first = await request(app)
        .patch(`/api/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'CANCEL_BOOKING', resolution: 'First resolution' });
      expect(first.status).toBe(200);

      const second = await request(app)
        .patch(`/api/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'CANCEL_BOOKING', resolution: 'Second attempt' });

      expect(second.status).toBe(409);
    });
  });
});
