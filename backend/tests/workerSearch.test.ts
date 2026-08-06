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
  });

  it('404s on worker detail for a nonexistent worker id', async () => {
    const res = await request(app).get('/api/workers/not-a-real-worker-id');
    expect(res.status).toBe(404);
  });
});
