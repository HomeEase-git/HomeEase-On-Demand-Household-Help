jest.mock('@services/xenditService', () => ({
  ...jest.requireActual('@services/xenditService'),
  createRefund: jest.fn(),
}));

import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const { createRefund } = require('@services/xenditService');

describe('POST /api/payments/:id/refund', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientToken: string;
  let clientId: string;
  let workerId: string;

  beforeAll(async () => {
    const { user: client, plainPassword: clientPw } = await createTestUser('refund-client', { role: 'CLIENT' });
    const { user: worker } = await createTestUser('refund-worker', { role: 'WORKER' });
    createdUserIds.push(client.id, worker.id);
    clientId = client.id;
    workerId = worker.id;

    const clientLogin = await request(app).post('/api/auth/login').send({ email: client.email, password: clientPw });
    clientToken = clientLogin.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdBookingIds) {
      await deleteTestBooking(id);
    }
    for (const id of createdUserIds) {
      await deleteTestUser(id);
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    (createRefund as jest.Mock).mockReset();
  });

  async function seedHeldPayment(overrides: {
    status?: 'PENDING' | 'COMPLETED';
    escrowStatus?: 'HELD' | 'RELEASED';
    xenditInvoiceId?: string;
    capturedAmount?: number;
  } = {}) {
    const booking = await createTestBooking({ clientId, workerId, status: 'ACCEPTED' });
    createdBookingIds.push(booking.id);
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        subtotal: 1000,
        commissionAmount: 100,
        withholdingTaxAmount: 50,
        workerPayout: 850,
        totalAmount: 1000,
        status: 'PENDING',
        escrowStatus: 'HELD',
        methodType: 'GCASH',
        ...overrides,
      },
    });
    return { booking, payment };
  }

  it('calls Xendit and marks REFUNDED for an already-captured payment', async () => {
    const { payment } = await seedHeldPayment({
      status: 'COMPLETED',
      xenditInvoiceId: `inv_refund_${Date.now()}`,
      capturedAmount: 1000,
    });
    (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_123', status: 'SUCCEEDED' });

    const res = await request(app)
      .post(`/api/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'Worker never arrived' });

    expect(res.status).toBe(200);
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ xenditInvoiceId: payment.xenditInvoiceId, amountPesos: 1000 })
    );

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.status).toBe('REFUNDED');
    expect(updated?.escrowStatus).toBe('REFUNDED');
  });

  it('does not call Xendit and voids escrow for a payment that was never captured', async () => {
    const { payment } = await seedHeldPayment({ status: 'PENDING' });

    const res = await request(app)
      .post(`/api/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'Client cancelled' });

    expect(res.status).toBe(200);
    expect(createRefund).not.toHaveBeenCalled();

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.escrowStatus).toBe('REFUNDED');
  });

  it('leaves escrow HELD and returns 502 when the Xendit refund call fails', async () => {
    const { payment } = await seedHeldPayment({
      status: 'COMPLETED',
      xenditInvoiceId: `inv_refund_fail_${Date.now()}`,
      capturedAmount: 1000,
    });
    (createRefund as jest.Mock).mockRejectedValueOnce(new Error('Xendit unavailable'));

    const res = await request(app)
      .post(`/api/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'Worker never arrived' });

    expect(res.status).toBe(502);

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.escrowStatus).toBe('HELD');
    expect(updated?.status).toBe('COMPLETED');
  });

  it('leaves escrow HELD and returns 502 when Xendit accepts the call but the refund does not succeed (e.g. PENDING/FAILED)', async () => {
    const { payment } = await seedHeldPayment({
      status: 'COMPLETED',
      xenditInvoiceId: `inv_refund_pending_${Date.now()}`,
      capturedAmount: 1000,
    });
    (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_456', status: 'PENDING' });

    const res = await request(app)
      .post(`/api/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'Worker never arrived' });

    expect(res.status).toBe(502);

    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(updated?.escrowStatus).toBe('HELD');
    expect(updated?.status).toBe('COMPLETED');
  });

  it('rejects a refund for escrow that is not HELD', async () => {
    const { payment } = await seedHeldPayment({ status: 'COMPLETED', escrowStatus: 'RELEASED' });

    const res = await request(app)
      .post(`/api/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'Too late' });

    expect(res.status).toBe(409);
    expect(createRefund).not.toHaveBeenCalled();
  });
});
