import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { TIER_1_REQUIRED_DOCUMENT_TYPES } from '../src/constants/kycRequirements';
import { createTestUser, deleteTestUser } from './helpers';

// Accepting the Worker Service Agreement is what submits a worker's
// application. It used to skip every completeness check when the worker had no
// open verification request (nothing uploaded), so an empty application
// reached the "waiting for review" state.

const PATH = '/api/users/me/contract-acceptance';

describe('POST /api/users/me/contract-acceptance (worker submission)', () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  async function newWorker(label: string) {
    const { user, plainPassword } = await createTestUser(label, { role: 'WORKER' });
    createdUserIds.push(user.id);
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
    return { userId: user.id, token: login.body.data.token as string };
  }

  const accept = (token: string) =>
    request(app).post(PATH).set('Authorization', `Bearer ${token}`).send({ contractType: 'WORKER_SERVICE_AGREEMENT' });

  it('rejects a worker who uploaded nothing and does not submit or record the acceptance', async () => {
    const { userId, token } = await newWorker('contract-empty');

    const res = await accept(token);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('GOVERNMENT_ID_FRONT');
    const profile = await prisma.workerProfile.findUnique({ where: { userId } });
    expect(profile?.kycStatus).not.toBe('SUBMITTED');
    expect(await prisma.contractAcceptance.count({ where: { userId } })).toBe(0);
  });

  it('rejects a worker with only some documents', async () => {
    const { userId, token } = await newWorker('contract-partial');
    const request_ = await prisma.verificationRequest.create({
      data: { userId, type: 'WORKER_ONBOARDING', status: 'PENDING' },
    });
    await prisma.kycDocument.create({
      data: {
        verificationRequestId: request_.id,
        documentType: 'GOVERNMENT_ID_FRONT',
        fileUrl: 'https://example.invalid/id.jpg',
        status: 'PENDING',
      },
    });

    const res = await accept(token);

    expect(res.status).toBe(400);
    expect(res.body.message).not.toContain('GOVERNMENT_ID_FRONT');
    expect(res.body.message).toContain('SELFIE');
    const profile = await prisma.workerProfile.findUnique({ where: { userId } });
    expect(profile?.kycStatus).not.toBe('SUBMITTED');
  });

  it('submits a complete application', async () => {
    const { userId, token } = await newWorker('contract-complete');
    const verification = await prisma.verificationRequest.create({
      data: { userId, type: 'WORKER_ONBOARDING', status: 'PENDING' },
    });
    for (const documentType of TIER_1_REQUIRED_DOCUMENT_TYPES) {
      await prisma.kycDocument.create({
        data: {
          verificationRequestId: verification.id,
          documentType,
          fileUrl: `https://example.invalid/${documentType}.jpg`,
          status: 'PENDING',
        },
      });
    }
    await prisma.workerProfile.update({
      where: { userId },
      data: { birthDate: new Date('1995-01-01'), yearsExperience: 3 },
    });

    const res = await accept(token);

    expect(res.status).toBe(201);
    const profile = await prisma.workerProfile.findUnique({ where: { userId } });
    expect(profile?.kycStatus).toBe('SUBMITTED');
    const updated = await prisma.verificationRequest.findUnique({ where: { id: verification.id } });
    expect(updated?.status).toBe('SUBMITTED');
  });

  it('does not treat a worker merely marked SUBMITTED as exempt from the checks', async () => {
    // The old upload endpoint used to set SUBMITTED after a single file.
    const { userId, token } = await newWorker('contract-legacy-submitted');
    const legacy = await prisma.verificationRequest.create({
      data: { userId, type: 'WORKER_ONBOARDING', status: 'PENDING' },
    });
    await prisma.kycDocument.create({
      data: { verificationRequestId: legacy.id, documentType: 'GOVERNMENT_ID_FRONT', fileUrl: 'https://example.invalid/id.jpg', status: 'PENDING' },
    });
    await prisma.workerProfile.update({ where: { userId }, data: { kycStatus: 'SUBMITTED' } });

    const res = await accept(token);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('SELFIE');
  });

  it('lets an already-approved worker re-accept without re-running the checks', async () => {
    const { userId, token } = await newWorker('contract-approved');
    await prisma.workerProfile.update({ where: { userId }, data: { kycStatus: 'APPROVED' } });

    const res = await accept(token);

    expect(res.status).toBe(201);
    const profile = await prisma.workerProfile.findUnique({ where: { userId } });
    expect(profile?.kycStatus).toBe('APPROVED');
  });
});
