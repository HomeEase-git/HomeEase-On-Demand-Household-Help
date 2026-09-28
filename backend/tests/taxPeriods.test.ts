const mockUpload = jest.fn().mockResolvedValue({ error: null });
jest.mock('@config/supabase', () => ({
  ...jest.requireActual('@config/supabase'),
  supabase: { storage: { from: () => ({ upload: mockUpload, createSignedUrl: jest.fn() }) } },
}));

import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

// Every payment is in 2031 so these quarters only see this file's data.
// Instants are written in UTC; the comment gives the Manila wall-clock time.
const PAYMENTS = [
  { at: '2031-06-30T15:00:00Z', wht: 1 }, //  Jun 30, 11 PM Manila -> Q2
  { at: '2031-06-30T18:00:00Z', wht: 10 }, // Jul 1, 2 AM Manila   -> Q3 (was Q2 when read as UTC)
  { at: '2031-08-15T04:00:00Z', wht: 20 }, // Aug 15               -> Q3
  { at: '2031-09-30T15:00:00Z', wht: 30 }, // Sep 30, 11 PM Manila -> Q3
  { at: '2031-09-30T19:00:00Z', wht: 100 }, // Oct 1, 3 AM Manila  -> Q4 (was Q3 when read as UTC)
];

describe('Tax periods in Manila time', () => {
  const createdUserIds: string[] = [];
  const bookingIds: string[] = [];
  let workerId: string;
  let adminToken: string;
  let previousAtc: string | null = null;

  beforeAll(async () => {
    const { user: client } = await createTestUser('taxp-client', { role: 'CLIENT' });
    const { user: worker } = await createTestUser('taxp-worker', { role: 'WORKER' });
    const { user: admin, plainPassword } = await createTestUser('taxp-admin', { role: 'ADMIN' });
    createdUserIds.push(client.id, worker.id, admin.id);
    workerId = worker.id;
    await prisma.workerProfile.update({ where: { userId: worker.id }, data: { tin: '123-456-789-000' } });

    const settings = await prisma.appSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
    previousAtc = settings.atcCode;
    await prisma.appSettings.update({ where: { id: 'singleton' }, data: { atcCode: 'WI160' } });

    for (const p of PAYMENTS) {
      const booking = await createTestBooking({ clientId: client.id, workerId: worker.id, status: 'COMPLETED' });
      bookingIds.push(booking.id);
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          subtotal: p.wht * 50,
          commissionAmount: p.wht * 5,
          withholdingTaxAmount: p.wht,
          workerPayout: p.wht * 44,
          totalAmount: p.wht * 50,
          status: 'COMPLETED',
          escrowStatus: 'RELEASED',
          methodType: 'GCASH',
          capturedAt: new Date(p.at),
        },
      });
    }

    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: plainPassword });
    adminToken = login.body.data.token;
  });

  afterAll(async () => {
    await prisma.appSettings.update({ where: { id: 'singleton' }, data: { atcCode: previousAtc } });
    await prisma.taxCertificate.deleteMany({ where: { workerId } });
    for (const id of bookingIds) await deleteTestBooking(id);
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  const asAdmin = (method: 'get' | 'post', path: string) =>
    request(app)[method](`/api/admin/tax${path}`).set('Authorization', `Bearer ${adminToken}`);

  it('issues a Q3 certificate with the payments made in Q3 Manila time, broken down by month', async () => {
    const res = await asAdmin('post', '/certificates/generate').send({ periodStart: '2031-07-01', periodEnd: '2031-10-01' });
    expect(res.status).toBe(201);
    expect(res.body.data.generated).toBe(1);

    const cert = await prisma.taxCertificate.findFirstOrThrow({ where: { workerId } });
    expect(cert.periodStart.toISOString()).toBe('2031-06-30T16:00:00.000Z');
    expect(cert.periodEnd.toISOString()).toBe('2031-09-30T16:00:00.000Z');
    expect(cert.totalTaxWithheld).toBe(60); // 10 + 20 + 30 — not the June 1 or the October 100
    expect(cert.totalIncomePayments).toBe(60 * 45); // subtotal − commission
    expect(cert.monthlyBreakdown).toEqual([
      { month: '2031-07', incomePayments: 450, taxWithheld: 10 },
      { month: '2031-08', incomePayments: 900, taxWithheld: 20 },
      { month: '2031-09', incomePayments: 1350, taxWithheld: 30 },
    ]);
    expect(mockUpload.mock.calls[0][0]).toMatch(new RegExp(`^${workerId}/2031-07-01_2031-10-01_`));
  });

  it('labels the period with its real last day in the admin list', async () => {
    const res = await asAdmin('get', '/certificates?limit=50').send();
    const mine = res.body.data.find((c: { workerId: string }) => c.workerId === workerId);
    expect(mine.periodLabel).toBe('Jul 1, 2031 to Sep 30, 2031');
    expect(mine.monthlyBreakdown).toHaveLength(3);
  });

  it('only issues certificates for a whole calendar quarter', async () => {
    const res = await asAdmin('post', '/certificates/generate').send({ periodStart: '2031-07-15', periodEnd: '2031-10-15' });
    expect(res.status).toBe(400);
  });

  it('shows remittance per quarter and per month in Manila time', async () => {
    const res = await asAdmin('get', `/remittance?periods=${encodeURIComponent('2031-07-01:2031-10-01,2031-10-01:2032-01-01')}`).send();
    expect(res.status).toBe(200);
    const [q3, q4] = res.body.data;
    expect(q3.totalTaxWithheld).toBe(60);
    expect(q3.months.map((m: { taxWithheld: number }) => m.taxWithheld)).toEqual([10, 20, 30]);
    expect(q4.totalTaxWithheld).toBe(100);
    expect(q4.months[0]).toMatchObject({ month: '2031-10', taxWithheld: 100 });
  });

  it('marks a quarter remitted under the Manila key, and finds it again', async () => {
    const mark = await asAdmin('post', '/remittance/mark-remitted').send({
      periodStart: '2031-07-01',
      periodEnd: '2031-10-01',
      referenceNumber: 'OR-2031-Q3',
    });
    expect(mark.status).toBe(200);
    expect(mark.body.data.totalTaxWithheld).toBe(60);

    const res = await asAdmin('get', `/remittance?periods=${encodeURIComponent('2031-07-01:2031-10-01')}`).send();
    expect(res.body.data[0]).toMatchObject({ status: 'REMITTED', referenceNumber: 'OR-2031-Q3' });
    await prisma.taxRemittance.deleteMany({ where: { referenceNumber: 'OR-2031-Q3' } });
  });
});
