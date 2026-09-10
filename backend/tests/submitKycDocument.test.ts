import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { verificationQueue } from '@queues/verificationQueue';
import { createTestUser, deleteTestUser } from './helpers';

// POST /api/users/me/kyc-documents records a KycDocument row from a URL returned
// by the earlier /kyc-documents/upload call. It used to store only documentType
// + fileUrl, leaving mimeType null (so the AI review filtered the doc out) and
// never queuing a review. It now derives mimeType/fileName from the URL and
// enqueues an analyze-verification job.

const PATH = '/api/users/me/kyc-documents';
const BASE = 'https://proj.supabase.co/storage/v1/object/public/kyc-documents';

describe('POST /api/users/me/kyc-documents', () => {
  const createdUserIds: string[] = [];
  let workerToken: string;
  let workerUserId: string;

  beforeAll(async () => {
    const { user, plainPassword } = await createTestUser('kyc-submit-worker', { role: 'WORKER' });
    createdUserIds.push(user.id);
    workerUserId = user.id;
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
    workerToken = login.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    (verificationQueue.add as jest.Mock).mockClear();
  });

  it('persists a mimeType derived from the image URL and queues an AI review', async () => {
    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ documentType: 'GOVERNMENT_ID_FRONT', documentUrl: `${BASE}/${workerUserId}/id-front.jpeg` });

    expect(res.status).toBe(201);

    const row = await prisma.kycDocument.findFirst({
      where: { documentType: 'GOVERNMENT_ID_FRONT', verificationRequest: { userId: workerUserId } },
      include: { verificationRequest: true },
    });
    expect(row?.mimeType).toBe('image/jpeg');
    expect(row?.fileName).toBe(`${workerUserId}/id-front.jpeg`);
    expect(row?.verificationRequest.aiStatus).toBe('PENDING');

    expect(verificationQueue.add as jest.Mock).toHaveBeenCalledWith(
      'analyze-verification',
      expect.objectContaining({
        verificationId: row?.verificationRequestId,
        documents: expect.arrayContaining([
          expect.objectContaining({ documentType: 'GOVERNMENT_ID_FRONT', mimeType: 'image/jpeg' }),
        ]),
      }),
      expect.anything()
    );
  });

  it('derives application/pdf for a .pdf URL and stores optional originalName', async () => {
    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        documentType: 'RESUME',
        documentUrl: `${BASE}/${workerUserId}/cv.pdf`,
        originalName: 'My CV.pdf',
        fileSize: 12345,
      });

    expect(res.status).toBe(201);

    const row = await prisma.kycDocument.findFirst({
      where: { documentType: 'RESUME', verificationRequest: { userId: workerUserId } },
    });
    expect(row?.mimeType).toBe('application/pdf');
    expect(row?.originalName).toBe('My CV.pdf');
    expect(row?.fileSize).toBe(12345);
  });

  it('rejects a non-string originalName', async () => {
    const res = await request(app)
      .post(PATH)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ documentType: 'SELFIE', documentUrl: `${BASE}/${workerUserId}/s.jpeg`, originalName: 42 });

    expect(res.status).toBe(400);
  });
});
