import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, completeWorkerSetup } from './helpers';

// Manila coordinates, mirroring tests/bookingFlow.test.ts.
const CLIENT_LOCATION = { lat: 14.5995, lng: 120.9842 };

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describe('Multi-day upfront booking — POST /api/bookings/multi-day', () => {
  const createdUserIds: string[] = [];
  const createdServiceTypeIds: string[] = [];
  let clientId: string;
  let clientToken: string;
  let workerId: string;
  let workerProfileId: string;
  let serviceTypeId: string;
  const serviceTypeName = `E2E Multi-Day Cleaning ${Date.now()}`;

  beforeAll(async () => {
    const { user: client, plainPassword: clientPw } = await createTestUser('multiday-client', { role: 'CLIENT' });
    const { user: worker } = await createTestUser('multiday-worker', { role: 'WORKER' });
    createdUserIds.push(client.id, worker.id);
    clientId = client.id;
    workerId = worker.id;

    const login = await request(app).post('/api/auth/login').send({ email: client.email, password: clientPw });
    clientToken = login.body.data.token;

    const serviceType = await prisma.serviceType.create({
      data: { name: serviceTypeName, basePrice: 1000 },
    });
    createdServiceTypeIds.push(serviceType.id);
    serviceTypeId = serviceType.id;

    const workerProfile = await prisma.workerProfile.update({
      where: { userId: workerId },
      data: {
        kycStatus: 'APPROVED',
        isAvailable: true,
        serviceCategories: {
          create: { serviceTypeId, status: 'VERIFIED' },
        },
      },
    });
    workerProfileId = workerProfile.id;
    await completeWorkerSetup(workerId, { serviceTypeId, ...CLIENT_LOCATION });
  });

  afterAll(async () => {
    for (const id of createdServiceTypeIds) {
      await prisma.serviceType.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  const basePayload = () => ({
    workerId,
    serviceType: serviceTypeName,
    address: '123 Test St, Test City',
    city: 'Manila',
    lat: CLIENT_LOCATION.lat,
    lng: CLIENT_LOCATION.lng,
    timeSlot: 'MORNING',
  });

  it('creates a BookingGroup + N linked Booking rows when every day is free', async () => {
    const start = isoDate(5);
    for (let i = 0; i < 3; i++) {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + i);
      await prisma.workerAvailability.create({
        data: { workerProfileId, date, timeSlot: 'MORNING', isBlocked: false },
      });
    }

    const res = await request(app)
      .post('/api/bookings/multi-day')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ ...basePayload(), startDate: start, dayCount: 3 });

    expect(res.status).toBe(201);
    expect(res.body.data.totalDays).toBe(3);
    expect(res.body.data.bookings).toHaveLength(3);
    expect(res.body.data.totalEstimatedPrice).toBe(3000);

    const group = await prisma.bookingGroup.findUnique({
      where: { id: res.body.data.groupId },
      include: { bookings: true },
    });
    expect(group).not.toBeNull();
    expect(group?.clientId).toBe(clientId);
    expect(group?.workerId).toBe(workerId);
    expect(group?.totalDays).toBe(3);
    expect(group?.bookings).toHaveLength(3);
    expect(group?.bookings.every((b) => b.groupId === res.body.data.groupId)).toBe(true);
    expect(group?.bookings.every((b) => b.status === 'PENDING')).toBe(true);
    expect(new Set(group?.bookings.map((b) => b.scheduledDate.toISOString().slice(0, 10))).size).toBe(3);
  });

  it('blocks the whole group, creating nothing, when one day in the middle conflicts', async () => {
    const start = isoDate(20);
    const day2 = new Date(start);
    day2.setUTCDate(day2.getUTCDate() + 1);

    // Day 1 and day 3 are open; day 2 is deliberately left with no
    // WorkerAvailability row at all, which isSlotAndOverflowFree treats as
    // unavailable (a slot must be explicitly opened to be bookable).
    const day1 = new Date(start);
    const day3 = new Date(start);
    day3.setUTCDate(day3.getUTCDate() + 2);
    await prisma.workerAvailability.create({ data: { workerProfileId, date: day1, timeSlot: 'MORNING', isBlocked: false } });
    await prisma.workerAvailability.create({ data: { workerProfileId, date: day3, timeSlot: 'MORNING', isBlocked: false } });

    const bookingCountBefore = await prisma.booking.count({ where: { workerId } });
    const groupCountBefore = await prisma.bookingGroup.count({ where: { workerId } });

    const res = await request(app)
      .post('/api/bookings/multi-day')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ ...basePayload(), startDate: start, dayCount: 3 });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(new RegExp(day2.toISOString().slice(0, 10)));

    const bookingCountAfter = await prisma.booking.count({ where: { workerId } });
    const groupCountAfter = await prisma.bookingGroup.count({ where: { workerId } });
    expect(bookingCountAfter).toBe(bookingCountBefore);
    expect(groupCountAfter).toBe(groupCountBefore);
  });

  it('rejects a non-integer/out-of-range dayCount before touching the database', async () => {
    const res = await request(app)
      .post('/api/bookings/multi-day')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ ...basePayload(), startDate: isoDate(5), dayCount: 1 });

    expect(res.status).toBe(400);
  });

  it('rejects a request with no workerId (multi-day has no auto-match)', async () => {
    const { workerId: _omit, ...payloadWithoutWorker } = basePayload();
    const res = await request(app)
      .post('/api/bookings/multi-day')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ ...payloadWithoutWorker, startDate: isoDate(5), dayCount: 2 });

    expect(res.status).toBe(400);
  });
});
