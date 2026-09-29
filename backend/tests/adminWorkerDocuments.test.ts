import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

const kycUrl = (userId: string, file: string) =>
  `https://example.supabase.co/storage/v1/object/public/kyc-documents/${userId}/${file}`;

describe('Admin worker documents', () => {
  const createdUserIds: string[] = [];
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    const { user, plainPassword } = await createTestUser('docs-admin', { role: 'ADMIN' });
    createdUserIds.push(user.id);
    adminId = user.id;
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
    adminToken = login.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  it('lists every upload once, grouped by submission, and audit-logs the viewing', async () => {
    const { user: worker } = await createTestUser('docs-worker', { role: 'WORKER' });
    createdUserIds.push(worker.id);
    const certUrl = kycUrl(worker.id, 'tesda.pdf');

    const older = await prisma.verificationRequest.create({
      data: {
        userId: worker.id,
        type: 'WORKER_ONBOARDING',
        status: 'REJECTED',
        submittedAt: new Date('2026-09-01T00:00:00Z'),
        documents: { create: [{ documentType: 'GOVERNMENT_ID_FRONT', fileUrl: kycUrl(worker.id, 'old-id.jpg'), status: 'REJECTED' }] },
      },
    });
    const newer = await prisma.verificationRequest.create({
      data: {
        userId: worker.id,
        type: 'WORKER_ONBOARDING',
        status: 'APPROVED',
        submittedAt: new Date('2026-09-10T00:00:00Z'),
        documents: {
          create: [
            { documentType: 'GOVERNMENT_ID_FRONT', fileUrl: kycUrl(worker.id, 'id.jpg'), status: 'APPROVED' },
            { documentType: 'CERTIFICATION', fileUrl: certUrl, originalName: 'tesda.pdf', status: 'APPROVED' },
          ],
        },
      },
    });
    const profile = await prisma.workerProfile.update({
      where: { userId: worker.id },
      data: { resumeUrl: kycUrl(worker.id, 'resume.pdf') },
    });
    // The KYC certificate copied into Certifications (same file) plus one
    // uploaded separately later.
    await prisma.certification.createMany({
      data: [
        { workerProfileId: profile.id, title: 'TESDA NC II', issuer: 'TESDA', issueDate: new Date('2025-01-01'), documentUrl: certUrl },
        { workerProfileId: profile.id, title: 'First Aid', issuer: 'Red Cross', issueDate: new Date('2025-06-01'), documentUrl: kycUrl(worker.id, 'first-aid.png') },
      ],
    });

    const res = await request(app)
      .get(`/api/admin/users/workers/${worker.id}/documents`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const docs = res.body.data as Array<Record<string, any>>;
    expect(docs.map((d) => [d.source, d.documentType])).toEqual([
      ['KYC', 'GOVERNMENT_ID_FRONT'],
      ['KYC', 'CERTIFICATION'],
      ['KYC', 'GOVERNMENT_ID_FRONT'],
      ['RESUME', 'RESUME'],
      ['CERTIFICATION', 'CERTIFICATION'],
    ]);
    expect(docs[0].verificationId).toBe(newer.id);
    expect(docs[2].verificationId).toBe(older.id);
    expect(docs[4].name).toBe('First Aid');
    expect(docs[3].mimeType).toBe('application/pdf');

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, action: 'WORKER_DOCUMENTS_VIEWED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.metadata).toMatchObject({ workerId: worker.id });
  });

  it('is admin-only and 404s for a non-worker', async () => {
    const { user: client, plainPassword } = await createTestUser('docs-client', { role: 'CLIENT' });
    createdUserIds.push(client.id);
    const login = await request(app).post('/api/auth/login').send({ email: client.email, password: plainPassword });

    const asClient = await request(app)
      .get(`/api/admin/users/workers/${client.id}/documents`)
      .set('Authorization', `Bearer ${login.body.data.token}`);
    expect(asClient.status).toBe(403);

    const notWorker = await request(app)
      .get(`/api/admin/users/workers/${client.id}/documents`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(notWorker.status).toBe(404);
  });
});
