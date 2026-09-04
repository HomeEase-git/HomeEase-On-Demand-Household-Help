jest.mock('@services/xenditService', () => ({
  ...jest.requireActual('@services/xenditService'),
  createRefund: jest.fn(),
}));

import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { refundOrVoidPayment } from '@services/paymentLifecycleService';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const { createRefund } = require('@services/xenditService');

describe('Refunds — pay-after-completion model', () => {
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

  async function seedPayment(overrides: {
    status?: 'PENDING' | 'COMPLETED' | 'REFUNDED';
    escrowStatus?: 'HELD' | 'RELEASED' | 'REFUNDED';
    methodType?: 'GCASH' | 'MAYA' | 'CASH';
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
        withholdingTaxAmount: 18,
        workerPayout: 882,
        totalAmount: 1000,
        status: 'PENDING',
        escrowStatus: 'HELD',
        methodType: 'GCASH',
        ...overrides,
      },
    });
    return { booking, payment };
  }

  describe('POST /api/payments/:id/refund (client)', () => {
    it('voids a still-unpaid (PENDING) payment without calling Xendit', async () => {
      const { payment } = await seedPayment({ status: 'PENDING' });

      const res = await request(app)
        .post(`/api/payments/${payment.id}/refund`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Client cancelled' });

      expect(res.status).toBe(200);
      expect(createRefund).not.toHaveBeenCalled();

      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.status).toBe('FAILED');
      expect(updated?.escrowStatus).toBe('REFUNDED');
    });

    it('opens a dispute (202) for a COMPLETED payment instead of refunding directly', async () => {
      const { booking, payment } = await seedPayment({
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        xenditInvoiceId: `inv_refund_${Date.now()}`,
        capturedAmount: 1000,
      });

      const res = await request(app)
        .post(`/api/payments/${payment.id}/refund`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Worker never arrived' });

      expect(res.status).toBe(202);
      expect(createRefund).not.toHaveBeenCalled();

      const dispute = await prisma.dispute.findFirst({ where: { bookingId: booking.id } });
      expect(dispute).not.toBeNull();
      expect(dispute?.status).toBe('OPEN');

      const unchanged = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(unchanged?.status).toBe('COMPLETED');
    });

    it('rejects a refund for a payment that is already REFUNDED', async () => {
      const { payment } = await seedPayment({ status: 'REFUNDED', escrowStatus: 'REFUNDED' });

      const res = await request(app)
        .post(`/api/payments/${payment.id}/refund`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Too late' });

      expect(res.status).toBe(409);
      expect(createRefund).not.toHaveBeenCalled();
    });
  });

  describe('refundOrVoidPayment (service — used by admin dispute resolution)', () => {
    it('calls Xendit and marks REFUNDED for a captured GCash payment', async () => {
      const { booking, payment } = await seedPayment({
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        xenditInvoiceId: `inv_svc_${Date.now()}`,
        capturedAmount: 1000,
      });
      (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_123', status: 'SUCCEEDED' });

      await refundOrVoidPayment(booking.id, 'Worker never arrived');

      expect(createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ xenditInvoiceId: payment.xenditInvoiceId, amountPesos: 1000 })
      );
      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.status).toBe('REFUNDED');
      expect(updated?.escrowStatus).toBe('REFUNDED');
    });

    it('throws (leaving the payment intact) when the Xendit refund does not succeed', async () => {
      const { booking, payment } = await seedPayment({
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        xenditInvoiceId: `inv_svc_fail_${Date.now()}`,
        capturedAmount: 1000,
      });
      (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_456', status: 'PENDING' });

      await expect(refundOrVoidPayment(booking.id, 'Worker never arrived')).rejects.toThrow();

      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.escrowStatus).toBe('RELEASED');
    });

    it('reverses the cash-job commission debt for a CASH payment', async () => {
      const { booking, payment } = await seedPayment({
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        methodType: 'CASH',
      });

      // Simulate the debt that settleCashBooking would have accrued.
      const workerProfile = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
      await prisma.workerProfile.update({
        where: { id: workerProfile.id },
        data: { commissionOwed: 118 },
      });

      await refundOrVoidPayment(booking.id, 'Client complaint upheld');

      expect(createRefund).not.toHaveBeenCalled();
      const updatedProfile = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfile.id } });
      expect(updatedProfile.commissionOwed).toBeCloseTo(0, 2);
      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.status).toBe('REFUNDED');
    });
  });
});
