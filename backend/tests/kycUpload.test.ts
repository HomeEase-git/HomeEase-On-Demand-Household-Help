import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

const mockUpload = jest.fn((..._args: any[]) => Promise.resolve({ data: {}, error: null }));
const mockGetPublicUrl = jest.fn((..._args: any[]) => ({
  data: { publicUrl: 'https://mock.supabase.local/mock-path' },
}));

jest.mock('@config/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  },
  KYC_DOCUMENT_BUCKET: 'kyc-documents-test',
}));

const UPLOAD_PATH = '/api/verification/upload';

function attachFile(req: request.Test, field = 'documents') {
  return req.attach(field, Buffer.from('fake-image-bytes'), {
    filename: 'id-front.jpg',
    contentType: 'image/jpeg',
  });
}

describe('KYC document upload', () => {
  const createdUserIds: string[] = [];
  let workerToken: string;
  let workerUserId: string;

  beforeAll(async () => {
    const { user: worker, plainPassword } = await createTestUser('kyc-upload-worker', { role: 'WORKER' });
    createdUserIds.push(worker.id);
    workerUserId = worker.id;

    const login = await request(app).post('/api/auth/login').send({ email: worker.email, password: plainPassword });
    workerToken = login.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    mockUpload.mockClear();
    mockGetPublicUrl.mockClear();
  });

  it('rejects an upload with no documentType', async () => {
    const res = await attachFile(
      request(app).post(UPLOAD_PATH).set('Authorization', `Bearer ${workerToken}`)
    );

    expect(res.status).toBe(400);
  });

  it('rejects an upload with an invalid documentType', async () => {
    const res = await attachFile(
      request(app)
        .post(UPLOAD_PATH)
        .set('Authorization', `Bearer ${workerToken}`)
        .field('documentType', 'NOT_A_REAL_DOC_TYPE')
    );

    expect(res.status).toBe(400);
  });

  it('rejects an upload with no file attached', async () => {
    const res = await request(app)
      .post(UPLOAD_PATH)
      .set('Authorization', `Bearer ${workerToken}`)
      .field('documentType', 'GOVERNMENT_ID_FRONT');

    expect(res.status).toBe(400);
  });

  it('accepts a valid upload, stores it via Supabase, and flips kycStatus to SUBMITTED', async () => {
    const res = await attachFile(
      request(app)
        .post(UPLOAD_PATH)
        .set('Authorization', `Bearer ${workerToken}`)
        .field('documentType', 'GOVERNMENT_ID_FRONT')
    );

    expect(res.status).toBe(201);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(res.body.data.documents).toHaveLength(1);
    expect(res.body.data.documentType).toBe('government_id_front');

    const worker = await prisma.workerProfile.findUnique({ where: { userId: workerUserId } });
    expect(worker?.kycStatus).toBe('SUBMITTED');

    const mine = await request(app).get('/api/verification/mine').set('Authorization', `Bearer ${workerToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Admin verification approval — Tier 1 document completeness gate', () => {
  const createdUserIds: string[] = [];
  let workerToken: string;
  let workerUserId: string;
  let adminToken: string;

  beforeAll(async () => {
    const { user: worker, plainPassword: workerPw } = await createTestUser('kyc-approval-worker', { role: 'WORKER' });
    const { user: admin, plainPassword: adminPw } = await createTestUser('kyc-approval-admin', { role: 'ADMIN' });
    createdUserIds.push(worker.id, admin.id);
    workerUserId = worker.id;

    const [workerLogin, adminLogin] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: worker.email, password: workerPw }),
      request(app).post('/api/auth/login').send({ email: admin.email, password: adminPw }),
    ]);
    workerToken = workerLogin.body.data.token;
    adminToken = adminLogin.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  it('blocks approval when required Tier 1 documents are missing, without an override reason', async () => {
    const uploadRes = await attachFile(
      request(app)
        .post(UPLOAD_PATH)
        .set('Authorization', `Bearer ${workerToken}`)
        .field('documentType', 'GOVERNMENT_ID_FRONT')
    );
    const verificationId = uploadRes.body.data.id as string;

    const approveRes = await request(app)
      .patch(`/api/admin/verifications/${verificationId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(approveRes.status).toBe(400);
    expect(approveRes.body.message).toMatch(/missing required documents/i);

    const worker = await prisma.workerProfile.findUnique({ where: { userId: workerUserId } });
    expect(worker?.kycStatus).not.toBe('APPROVED');
  });

  it('allows approval despite missing documents when an admin override reason is given', async () => {
    const uploadRes = await attachFile(
      request(app)
        .post(UPLOAD_PATH)
        .set('Authorization', `Bearer ${workerToken}`)
        .field('documentType', 'GOVERNMENT_ID_FRONT')
    );
    const verificationId = uploadRes.body.data.id as string;

    const approveRes = await request(app)
      .patch(`/api/admin/verifications/${verificationId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ adminOverrideReason: 'Manually confirmed identity via video call' });

    expect(approveRes.status).toBe(200);

    const worker = await prisma.workerProfile.findUnique({ where: { userId: workerUserId } });
    expect(worker?.kycStatus).toBe('APPROVED');
  });
});
