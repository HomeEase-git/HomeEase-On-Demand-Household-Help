import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

describe('Admin verification approve/reject', () => {
  const createdUserIds: string[] = [];
  let adminToken: string;

  beforeAll(async () => {
    // Warm up the Neon connection pool before the timing-sensitive
    // $transaction calls in approve/reject — a cold first connection can
    // occasionally push those past Prisma's 5s interactive-transaction timeout.
    await prisma.user.count();

    const { user, plainPassword } = await createTestUser('verif-admin', { role: 'ADMIN' });
    createdUserIds.push(user.id);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: plainPassword });
    adminToken = login.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  async function seedPendingVerification(label: string) {
    const { user: worker } = await createTestUser(label, { role: 'WORKER' });
    createdUserIds.push(worker.id);

    const verification = await prisma.verificationRequest.create({
      data: {
        userId: worker.id,
        type: 'WORKER_ONBOARDING',
        status: 'PENDING',
        documents: {
          // All 4 Tier 1 required types (see documents.MD / adminVerificationController's
          // approval completeness gate) so approval tests reflect a realistic, complete
          // submission — the incomplete-submission path is covered separately in kycUpload.test.ts.
          create: [
            { documentType: 'GOVERNMENT_ID_FRONT', fileUrl: 'https://example.invalid/id-front.jpg' },
            { documentType: 'GOVERNMENT_ID_BACK', fileUrl: 'https://example.invalid/id-back.jpg' },
            { documentType: 'SELFIE', fileUrl: 'https://example.invalid/selfie.jpg' },
            { documentType: 'NBI_CLEARANCE', fileUrl: 'https://example.invalid/nbi.jpg' },
          ],
        },
      },
    });

    return { worker, verification };
  }

  it('lists the seeded pending verification', async () => {
    const { worker, verification } = await seedPendingVerification('list');

    const res = await request(app)
      .get('/api/admin/verifications?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some((v: { id: string }) => v.id === verification.id)).toBe(true);
    expect(res.body.data.find((v: { id: string }) => v.id === verification.id).name).toBe(worker.fullName);
  });

  it('approves a verification, updates worker KYC status, and notifies the worker', async () => {
    const { worker, verification } = await seedPendingVerification('approve');

    const res = await request(app)
      .patch(`/api/admin/verifications/${verification.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ adminOverrideReason: '' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');

    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: worker.id } });
    expect(workerProfile?.kycStatus).toBe('APPROVED');
    expect(workerProfile?.kycApprovedAt).not.toBeNull();

    const notifications = await prisma.notification.findMany({ where: { userId: worker.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('VERIFICATION_APPROVED');
  });

  it('rejects an already-approved verification', async () => {
    const { verification } = await seedPendingVerification('double-approve');

    await request(app)
      .patch(`/api/admin/verifications/${verification.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    const res = await request(app)
      .patch(`/api/admin/verifications/${verification.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects a verification with a reason, updates worker KYC status, and notifies the worker', async () => {
    const { worker, verification } = await seedPendingVerification('reject');

    const res = await request(app)
      .patch(`/api/admin/verifications/${verification.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rejectReason: 'Government ID photo is blurry' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');

    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: worker.id } });
    expect(workerProfile?.kycStatus).toBe('REJECTED');

    const notifications = await prisma.notification.findMany({ where: { userId: worker.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('VERIFICATION_REJECTED');
    expect(notifications[0].message).toContain('Government ID photo is blurry');
  });

  it('requires a rejection reason', async () => {
    const { verification } = await seedPendingVerification('reject-no-reason');

    const res = await request(app)
      .patch(`/api/admin/verifications/${verification.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('queues an AI rerun for a pending verification', async () => {
    const { verification } = await seedPendingVerification('rerun');

    const res = await request(app)
      .patch(`/api/admin/verifications/${verification.id}/rerun`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.aiStatus).toBe('PENDING');
  });

  it('blocks non-admin tokens from the approve endpoint', async () => {
    const { worker, verification } = await seedPendingVerification('gate');
    // worker itself trying to approve its own verification
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: worker.email, password: 'TestPass123!' });

    const res = await request(app)
      .patch(`/api/admin/verifications/${verification.id}/approve`)
      .set('Authorization', `Bearer ${login.body.data.token}`)
      .send({});

    expect(res.status).toBe(403);
  });
});