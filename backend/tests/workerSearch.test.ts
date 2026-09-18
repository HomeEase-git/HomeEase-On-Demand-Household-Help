import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

describe('Worker search & detail — KYC visibility gate', () => {
  const createdUserIds: string[] = [];
  let workerUserId: string;

  beforeAll(async () => {
    const { user: worker } = await createTestUser('worker-visibility', { role: 'WORKER' });
    createdUserIds.push(worker.id);
    workerUserId = worker.id;
    // createTestUser leaves kycStatus at its schema default (PENDING).
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  it('excludes a PENDING-KYC worker from search results', async () => {
    const res = await request(app).get('/api/workers').query({ limit: 100 });

    expect(res.status).toBe(200);
    const ids = res.body.data.workers.map((w: { id: string }) => w.id);
    expect(ids).not.toContain(workerUserId);
  });

  it('404s on worker detail for a PENDING-KYC worker', async () => {
    const res = await request(app).get(`/api/workers/${workerUserId}`);
    expect(res.status).toBe(404);
  });

  it('404s on worker reviews for a PENDING-KYC worker', async () => {
    const res = await request(app).get(`/api/workers/${workerUserId}/reviews`);
    expect(res.status).toBe(404);
  });

  it('404s on worker availability for a PENDING-KYC worker', async () => {
    const res = await request(app)
      .get(`/api/workers/${workerUserId}/availability`)
      .query({ date: '2026-09-01' });
    expect(res.status).toBe(404);
  });

  it('404s on worker blocked-dates for a PENDING-KYC worker', async () => {
    const res = await request(app).get(`/api/workers/${workerUserId}/blocked-dates`);
    expect(res.status).toBe(404);
  });

  describe('once approved', () => {
    beforeAll(async () => {
      await prisma.workerProfile.update({
        where: { userId: workerUserId },
        data: { kycStatus: 'APPROVED' },
      });
    });

    it('includes the worker in search results', async () => {
      const res = await request(app).get('/api/workers').query({ limit: 100 });

      expect(res.status).toBe(200);
      const ids = res.body.data.workers.map((w: { id: string }) => w.id);
      expect(ids).toContain(workerUserId);
    });

    it('returns worker detail successfully', async () => {
      const res = await request(app).get(`/api/workers/${workerUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(workerUserId);
    });

    it('returns worker reviews successfully', async () => {
      const res = await request(app).get(`/api/workers/${workerUserId}/reviews`);
      expect(res.status).toBe(200);
    });

    it('returns worker availability successfully', async () => {
      const res = await request(app)
        .get(`/api/workers/${workerUserId}/availability`)
        .query({ date: '2026-09-01' });
      expect(res.status).toBe(200);
    });

    it('returns worker blocked-dates successfully', async () => {
      const res = await request(app).get(`/api/workers/${workerUserId}/blocked-dates`);
      expect(res.status).toBe(200);
    });

    it('only surfaces certifications that are both APPROVED and visibleToClients, and never leaks resumeUrl/rawText', async () => {
      const workerProfile = await prisma.workerProfile.findUniqueOrThrow({
        where: { userId: workerUserId },
        select: { id: true },
      });

      await prisma.certification.createMany({
        data: [
          { workerProfileId: workerProfile.id, title: 'Pending Cert', issuer: 'X', issueDate: new Date(), documentUrl: 'https://example.invalid/a.pdf', verificationStatus: 'PENDING' },
          { workerProfileId: workerProfile.id, title: 'Hidden Cert', issuer: 'X', issueDate: new Date(), documentUrl: 'https://example.invalid/b.pdf', verificationStatus: 'APPROVED', visibleToClients: false },
          { workerProfileId: workerProfile.id, title: 'Visible Cert', issuer: 'X', issueDate: new Date(), documentUrl: 'https://example.invalid/c.pdf', verificationStatus: 'APPROVED', visibleToClients: true },
        ],
      });

      await prisma.workerProfile.update({
        where: { userId: workerUserId },
        data: {
          resumeUrl: 'https://example.invalid/resume.pdf',
          resumeParseResult: {
            upsert: {
              create: { rawText: 'Contact me at secret@example.com', parsedSkills: ['plumbing'], summary: 'A summary' },
              update: {},
            },
          },
        },
      });

      const res = await request(app).get(`/api/workers/${workerUserId}`);

      expect(res.status).toBe(200);
      const titles = res.body.data.certifications.map((c: { title: string }) => c.title);
      expect(titles).toEqual(['Visible Cert']);
      expect(res.body.data.resumeUrl).toBeUndefined();
      expect(res.body.data.resumeParseResult.rawText).toBeUndefined();
      expect(res.body.data.resumeParseResult.summary).toBe('A summary');
    });
  });

  it('404s on worker detail for a nonexistent worker id', async () => {
    const res = await request(app).get('/api/workers/not-a-real-worker-id');
    expect(res.status).toBe(404);
  });
});
