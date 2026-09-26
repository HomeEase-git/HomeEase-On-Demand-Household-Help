import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, completeWorkerSetup } from './helpers';

// Admin-fixed prices, requesting a new service with documents, worker
// packages needing admin approval, and the account-setup gate.
describe('Worker services, packages and setup', () => {
  const createdUserIds: string[] = [];
  const createdServiceTypeIds: string[] = [];
  let adminToken: string;
  let clientToken: string;
  let workerId: string;
  let workerToken: string;
  let workerProfileId: string;
  let firstServiceId: string;
  let secondServiceId: string;
  let secondTaskId: string;

  const login = async (email: string, password: string) =>
    (await request(app).post('/api/auth/login').send({ email, password })).body.data.token as string;

  const newService = async (label: string, basePrice = 800) => {
    const st = await prisma.serviceType.create({
      data: {
        name: `e2e ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        basePrice,
        tasks: { create: { name: `${label} job`, basePrice, pricingModel: 'FIXED' } },
      },
      include: { tasks: true },
    });
    createdServiceTypeIds.push(st.id);
    return st;
  };

  const doc = (title: string) => ({
    title,
    issuer: 'TESDA',
    issueDate: '2024-01-15',
    documentUrl: `https://example.invalid/${encodeURIComponent(title)}.png`,
  });

  beforeAll(async () => {
    const admin = await createTestUser('svc-admin', { role: 'ADMIN' });
    const client = await createTestUser('svc-client', { role: 'CLIENT' });
    const worker = await createTestUser('svc-worker', { role: 'WORKER' });
    createdUserIds.push(admin.user.id, client.user.id, worker.user.id);
    workerId = worker.user.id;
    [adminToken, clientToken, workerToken] = await Promise.all([
      login(admin.user.email, admin.plainPassword),
      login(client.user.email, client.plainPassword),
      login(worker.user.email, worker.plainPassword),
    ]);
    const profile = await prisma.workerProfile.update({
      where: { userId: workerId },
      data: { kycStatus: 'APPROVED' },
    });
    workerProfileId = profile.id;
    firstServiceId = (await newService('first')).id;
    const second = await newService('second', 1200);
    secondServiceId = second.id;
    secondTaskId = second.tasks[0].id;
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.serviceType.deleteMany({ where: { id: { in: createdServiceTypeIds } } });
    await prisma.$disconnect();
  });

  describe('requesting services', () => {
    it("adds a worker's first service straight away", async () => {
      const res = await request(app)
        .post('/api/workers/me/service-types')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ serviceTypeId: firstServiceId });
      expect(res.status).toBe(201);
      expect(res.body.data.serviceCategory.status).toBe('VERIFIED');
    });

    it('needs documents to request a second service', async () => {
      const res = await request(app)
        .post('/api/workers/me/service-types')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ serviceTypeId: secondServiceId });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/certification or document/);
    });

    it('files the request with every attached document for admin review', async () => {
      const res = await request(app)
        .post('/api/workers/me/service-types')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ serviceTypeId: secondServiceId, certifications: [doc('NC II'), doc('Training cert')] });
      expect(res.status).toBe(201);
      expect(res.body.data.serviceCategory.status).toBe('PENDING_VERIFICATION');

      const docs = await prisma.certification.findMany({ where: { workerProfileId, serviceTypeId: secondServiceId } });
      expect(docs.map((d) => d.title).sort()).toEqual(['NC II', 'Training cert']);
      expect(docs.every((d) => d.verificationStatus === 'PENDING')).toBe(true);
    });

    it("won't let the worker pick tasks in a service that isn't approved yet", async () => {
      const res = await request(app)
        .put(`/api/workers/me/task-selections/${secondTaskId}`)
        .set('Authorization', `Bearer ${workerToken}`);
      expect(res.status).toBe(403);
    });

    it('lists the request, with its documents, in the admin queue', async () => {
      const res = await request(app).get('/api/admin/service-requests').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const mine = res.body.data.find(
        (r: { worker: { userId: string }; serviceType: { id: string } }) =>
          r.worker.userId === workerId && r.serviceType.id === secondServiceId
      );
      expect(mine).toBeDefined();
      expect(mine.documents).toHaveLength(2);
    });

    it('unlocks the service and its documents when the admin approves', async () => {
      const category = await prisma.workerServiceCategory.findUniqueOrThrow({
        where: { workerProfileId_serviceTypeId: { workerProfileId, serviceTypeId: secondServiceId } },
      });
      const res = await request(app)
        .patch(`/api/admin/service-requests/${category.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);

      const after = await prisma.workerServiceCategory.findUniqueOrThrow({ where: { id: category.id } });
      expect(after.status).toBe('VERIFIED');
      const docs = await prisma.certification.findMany({ where: { workerProfileId, serviceTypeId: secondServiceId } });
      expect(docs.every((d) => d.verificationStatus === 'APPROVED')).toBe(true);

      const select = await request(app)
        .put(`/api/workers/me/task-selections/${secondTaskId}`)
        .set('Authorization', `Bearer ${workerToken}`);
      expect(select.status).toBe(200);
    });

    it('keeps the service registered when its last task is unticked', async () => {
      const res = await request(app)
        .delete(`/api/workers/me/task-selections/${secondTaskId}`)
        .set('Authorization', `Bearer ${workerToken}`);
      expect(res.status).toBe(200);
      const category = await prisma.workerServiceCategory.findUnique({
        where: { workerProfileId_serviceTypeId: { workerProfileId, serviceTypeId: secondServiceId } },
      });
      expect(category?.status).toBe('VERIFIED');
    });

    it('shows the admin price, not a worker range, in the catalog', async () => {
      const res = await request(app).get('/api/workers/me/task-catalog').set('Authorization', `Bearer ${workerToken}`);
      expect(res.status).toBe(200);
      const entry = res.body.data.categories.find((c: { serviceType: { id: string } }) => c.serviceType.id === secondServiceId);
      expect(entry.tasks[0].task.price).toBe(1200);
      expect(entry.tasks[0].task.minPrice).toBeUndefined();
    });

    it('no longer has a worker price endpoint', async () => {
      const res = await request(app)
        .put(`/api/workers/me/task-prices/${secondTaskId}`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ price: 5000 });
      expect(res.status).toBe(404);
    });
  });

  describe('packages', () => {
    let packageId: string;

    it('starts a new package pending and hides it from clients', async () => {
      const res = await request(app)
        .post('/api/workers/me/packages')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ serviceTypeId: firstServiceId, name: 'Deep clean bundle', price: 1500 });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');
      packageId = res.body.data.id;

      const pub = await request(app).get(`/api/workers/${workerId}/packages`);
      expect(pub.body.data.packages.map((p: { id: string }) => p.id)).not.toContain(packageId);
    });

    it('shows it to clients once the admin approves it, at the admin price', async () => {
      const res = await request(app)
        .patch(`/api/admin/packages/${packageId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 1300 });
      expect(res.status).toBe(200);

      const pub = await request(app).get(`/api/workers/${workerId}/packages`);
      const pkg = pub.body.data.packages.find((p: { id: string }) => p.id === packageId);
      expect(pkg.price).toBe(1300);
    });

    it('sends an edited package back for review', async () => {
      const res = await request(app)
        .patch(`/api/workers/me/packages/${packageId}`)
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ price: 2000 });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PENDING');

      const pub = await request(app).get(`/api/workers/${workerId}/packages`);
      expect(pub.body.data.packages.map((p: { id: string }) => p.id)).not.toContain(packageId);
    });
  });

  describe('account setup gate', () => {
    it('lists what is still missing', async () => {
      const res = await request(app).get('/api/workers/me/setup-status').set('Authorization', `Bearer ${workerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.complete).toBe(false);
      expect(res.body.data.missing).toEqual(
        expect.arrayContaining(['PROFILE_PHOTO', 'PAYOUT_METHOD', 'ADDRESS', 'AVAILABILITY', 'SERVICES'])
      );
    });

    it("blocks accepting a request until setup is complete", async () => {
      const booking = await prisma.booking.create({
        data: {
          clientId: createdUserIds[1],
          workerId,
          serviceType: 'Cleaning',
          description: 'setup gate',
          location: '123 Test St',
          city: 'Manila',
          scheduledDate: new Date(Date.now() + 5 * 86_400_000),
          timeSlot: 'MORNING',
          estimatedPrice: 800,
          status: 'PENDING',
        },
      });
      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/accept`)
        .set('Authorization', `Bearer ${workerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('WORKER_SETUP_INCOMPLETE');
    });

    it('charges the admin price once setup is complete, ignoring any old worker price', async () => {
      const { serviceTaskId } = await completeWorkerSetup(workerId, { serviceTypeId: firstServiceId });
      await prisma.serviceTask.update({ where: { id: serviceTaskId }, data: { basePrice: 900 } });
      // A price the worker set under the old model must not be charged.
      await prisma.workerTaskPrice.create({ data: { workerProfileId, serviceTaskId, price: 5000 } });

      const status = await request(app).get('/api/workers/me/setup-status').set('Authorization', `Bearer ${workerToken}`);
      expect(status.body.data.complete).toBe(true);

      const date = new Date(Date.now() + 6 * 86_400_000);
      date.setUTCHours(0, 0, 0, 0);
      await prisma.workerAvailability.create({ data: { workerProfileId, date, timeSlot: 'AFTERNOON', isBlocked: false } });

      const serviceType = await prisma.serviceType.findUniqueOrThrow({ where: { id: firstServiceId } });
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          workerId,
          serviceType: serviceType.name,
          serviceTaskId,
          address: '123 Test St',
          city: 'Manila',
          lat: 14.5995,
          lng: 120.9842,
          date: date.toISOString().slice(0, 10),
          timeSlot: 'AFTERNOON',
          paymentMethodType: 'CASH',
        });
      expect(res.status).toBe(201);
      const booking = await prisma.booking.findFirstOrThrow({ where: { workerId, serviceTaskId } });
      // New worker (no completed jobs) = STANDARD tier, 0 km = no distance fee.
      expect(booking.estimatedPrice).toBe(900);
    });
  });
});
