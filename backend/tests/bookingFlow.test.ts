import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

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
    it('rejects a quote submitted before the job has started', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED' });
      createdBookingIds.push(booking.id);

      const res = await request(app)
        .post(`/api/bookings/${booking.id}/quote`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ materialsCost: 200, notes: 'Extra materials needed' });

      expect(res.status).toBe(409);
    });

    it('pins laborCost to the settled estimate and moves the booking to QUOTE_SUBMITTED', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS', estimatedPrice: 1500 });
      createdBookingIds.push(booking.id);

      const res = await request(app)
        .post(`/api/bookings/${booking.id}/quote`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ materialsCost: 300, notes: 'Extra cleaning supplies' });

      expect(res.status).toBe(201);
      expect(res.body.data.laborCost).toBe(1500);
      expect(res.body.data.materialsCost).toBe(300);
      expect(res.body.data.totalCost).toBe(1800);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking?.status).toBe('QUOTE_SUBMITTED');
      expect(dbBooking?.quoteStatus).toBe('SUBMITTED');
    });

    it('rejects a quote submitted by a client', async () => {
      const booking = await createTestBooking({ clientId, workerId, status: 'IN_PROGRESS' });
      createdBookingIds.push(booking.id);

      const res = await request(app)
        .post(`/api/bookings/${booking.id}/quote`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ materialsCost: 100 });

      expect(res.status).toBe(403);
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

    it('REQUEST_NEW_QUOTE sends the booking back to IN_PROGRESS and clears the quote', async () => {
      const { bookingId, disputeId } = await seedDisputedBooking();

      const res = await request(app)
        .patch(`/api/admin/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'REQUEST_NEW_QUOTE', resolution: 'Please itemize the materials cost' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('RESOLVED_NEW_QUOTE_REQUESTED');

      const dbBooking = await prisma.booking.findUnique({ where: { id: bookingId } });
      expect(dbBooking?.status).toBe('IN_PROGRESS');
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
