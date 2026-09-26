import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, testEmail } from './helpers';

describe('POST /api/users/me/contract-acceptance', () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
  });

  async function loginAs(role: 'CLIENT' | 'WORKER', label: string) {
    const { user, plainPassword } = await createTestUser(label, { role });
    createdUserIds.push(user.id);
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
    return { user, token: res.body.data.token as string };
  }

  it('records server time, version, IP and user agent — ignoring a client-supplied date', async () => {
    const { user, token } = await loginAs('CLIENT', 'accept-client');
    const before = Date.now();

    const res = await request(app)
      .post('/api/users/me/contract-acceptance')
      .set('Authorization', `Bearer ${token}`)
      .set('User-Agent', 'HomeEase-Test/1.0')
      .send({ contractType: 'CLIENT_USER_AGREEMENT', contractVersion: '2026-09-25', acceptedAt: '2020-01-01T00:00:00Z' });

    expect(res.status).toBe(201);
    const row = await prisma.contractAcceptance.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.contractVersion).toBe('2026-09-25');
    expect(row.acceptedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.userAgent).toBe('HomeEase-Test/1.0');
    expect(row.ipAddress).toBeTruthy();
  });

  it('records a separate privacy-notice acknowledgment', async () => {
    const { user, token } = await loginAs('CLIENT', 'accept-privacy');

    const res = await request(app)
      .post('/api/users/me/contract-acceptance')
      .set('Authorization', `Bearer ${token}`)
      .send({ contractType: 'PRIVACY_NOTICE', contractVersion: '2026-09-25' });

    expect(res.status).toBe(201);
    expect(await prisma.contractAcceptance.count({ where: { userId: user.id, contractType: 'PRIVACY_NOTICE' } })).toBe(1);
  });

  it('does not submit a worker for KYC review when they only give KYC consent', async () => {
    const { user, token } = await loginAs('WORKER', 'accept-kyc-consent');
    const request_ = await prisma.verificationRequest.create({
      data: { userId: user.id, type: 'WORKER_ONBOARDING', status: 'PENDING' },
    });

    const res = await request(app)
      .post('/api/users/me/contract-acceptance')
      .set('Authorization', `Bearer ${token}`)
      .send({ contractType: 'KYC_CONSENT', contractVersion: '2026-09-25' });

    expect(res.status).toBe(201);
    expect((await prisma.verificationRequest.findUnique({ where: { id: request_.id } }))?.status).toBe('PENDING');
  });

  it('will not submit a worker for review without a resume', async () => {
    const { user, token } = await loginAs('WORKER', 'accept-no-resume');
    await prisma.workerProfile.update({ where: { userId: user.id }, data: { birthDate: new Date('1990-01-01T00:00:00Z') } });
    const verification = await prisma.verificationRequest.create({
      data: {
        userId: user.id,
        type: 'WORKER_ONBOARDING',
        status: 'PENDING',
        documents: {
          create: [
            { documentType: 'GOVERNMENT_ID_FRONT', fileUrl: 'https://example.invalid/front.jpg' },
            { documentType: 'GOVERNMENT_ID_BACK', fileUrl: 'https://example.invalid/back.jpg' },
            { documentType: 'SELFIE', fileUrl: 'https://example.invalid/selfie.jpg' },
            { documentType: 'NBI_CLEARANCE', fileUrl: 'https://example.invalid/nbi.jpg' },
          ],
        },
      },
    });

    const res = await request(app)
      .post('/api/users/me/contract-acceptance')
      .set('Authorization', `Bearer ${token}`)
      .send({ contractType: 'WORKER_SERVICE_AGREEMENT', contractVersion: '2026-09-25' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/RESUME/);
    expect((await prisma.verificationRequest.findUnique({ where: { id: verification.id } }))?.status).toBe('PENDING');
  });

  it("rejects a contract type that doesn't apply to the account's role, or an unknown one", async () => {
    const { token } = await loginAs('CLIENT', 'accept-wrong-role');

    const wrongRole = await request(app)
      .post('/api/users/me/contract-acceptance')
      .set('Authorization', `Bearer ${token}`)
      .send({ contractType: 'KYC_CONSENT' });
    const unknown = await request(app)
      .post('/api/users/me/contract-acceptance')
      .set('Authorization', `Bearer ${token}`)
      .send({ contractType: 'SOMETHING_ELSE' });

    expect(wrongRole.status).toBe(400);
    expect(unknown.status).toBe(400);
  });

  it('records the Privacy Policy consent given at sign-up', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('User-Agent', 'HomeEase-Test/1.0')
      .send({
        fullName: 'Privacy Signup',
        email: testEmail('privacy-signup'),
        phone: '09170000001',
        password: 'TestPass123!',
        role: 'CLIENT',
        privacyNoticeVersion: '2026-09-25',
      });

    expect(res.status).toBe(201);
    const user = await prisma.user.findFirstOrThrow({ where: { fullName: 'Privacy Signup' }, orderBy: { createdAt: 'desc' } });
    createdUserIds.push(user.id);
    const row = await prisma.contractAcceptance.findFirstOrThrow({ where: { userId: user.id } });
    expect(row).toMatchObject({ contractType: 'PRIVACY_NOTICE', contractVersion: '2026-09-25', userAgent: 'HomeEase-Test/1.0' });
  });
});
