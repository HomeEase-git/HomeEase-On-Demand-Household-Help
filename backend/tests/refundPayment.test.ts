jest.mock('@services/xenditService', () => ({
  ...jest.requireActual('@services/xenditService'),
  createRefund: jest.fn(),
  retrieveRefund: jest.fn(),
}));

jest.mock('@services/xenditDisbursementService', () => ({
  ...jest.requireActual('@services/xenditDisbursementService'),
  cancelPayout: jest.fn(),
  retrievePayout: jest.fn(),
}));

import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { refundOrVoidPayment, reconcilePendingRefund, settleWorkerEarnings } from '@services/paymentLifecycleService';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const { createRefund, retrieveRefund } = require('@services/xenditService');
const { cancelPayout, retrievePayout } = require('@services/xenditDisbursementService');

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
    (retrieveRefund as jest.Mock).mockReset();
    (cancelPayout as jest.Mock).mockReset();
    (retrievePayout as jest.Mock).mockReset();
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
      (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_456', status: 'FAILED' });

      await expect(refundOrVoidPayment(booking.id, 'Worker never arrived')).rejects.toThrow();

      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.escrowStatus).toBe('RELEASED');
      expect(updated?.xenditRefundId).toBe('refund_456');
      expect(updated?.xenditRefundStatus).toBe('FAILED');
    });

    it('accepts a PENDING refund (normal for e-wallets) and records it for the sweep', async () => {
      const { booking, payment } = await seedPayment({
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        xenditInvoiceId: `inv_svc_pending_${Date.now()}`,
        capturedAmount: 1000,
      });
      (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_pending', status: 'PENDING' });

      await refundOrVoidPayment(booking.id, 'Worker never arrived');

      expect(createRefund).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `refund-${payment.id}` }));
      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.status).toBe('REFUNDED');
      expect(updated?.xenditRefundStatus).toBe('PENDING');
    });

    it('reuses an earlier refund instead of refunding the client twice', async () => {
      const { booking, payment } = await seedPayment({
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        xenditInvoiceId: `inv_svc_reuse_${Date.now()}`,
        capturedAmount: 1000,
      });
      // A previous attempt reached Xendit but crashed before marking the payment refunded.
      await prisma.payment.update({
        where: { id: payment.id },
        data: { xenditRefundId: 'refund_earlier', xenditRefundStatus: 'PENDING' },
      });
      (retrieveRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_earlier', status: 'SUCCEEDED' });

      await refundOrVoidPayment(booking.id, 'Worker never arrived');

      expect(createRefund).not.toHaveBeenCalled();
      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.status).toBe('REFUNDED');
    });

    it('retries a failed refund under a new idempotency key', async () => {
      const { booking, payment } = await seedPayment({
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        xenditInvoiceId: `inv_svc_retry_${Date.now()}`,
        capturedAmount: 1000,
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: { xenditRefundId: 'refund_failed', xenditRefundStatus: 'FAILED' },
      });
      (retrieveRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_failed', status: 'FAILED' });
      (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_second', status: 'SUCCEEDED' });

      await refundOrVoidPayment(booking.id, 'Worker never arrived');

      expect(createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: `refund-${payment.id}-after-refund_failed` })
      );
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

  describe('refunds never let the worker payout go out as well', () => {
    async function seedPaidOnline(payoutStatus?: 'PENDING' | 'PROCESSING' | 'FAILED' | 'PAID', xenditDisbursementId?: string) {
      const { booking, payment } = await seedPayment({
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        xenditInvoiceId: `inv_dp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        capturedAmount: 1000,
      });
      if (!payoutStatus) return { booking, payment, payout: null };
      await prisma.payment.update({ where: { id: payment.id }, data: { workerSettledAt: new Date() } });
      const payout = await prisma.payout.create({
        data: {
          paymentId: payment.id,
          bookingId: booking.id,
          workerId,
          amount: 882,
          channel: 'GCASH',
          accountNumber: '09171234567',
          status: payoutStatus,
          xenditDisbursementId: xenditDisbursementId ?? null,
        },
      });
      return { booking, payment, payout };
    }

    it('blocks settlement of a not-yet-settled payment so no payout is ever created', async () => {
      const { booking, payment } = await seedPaidOnline();
      (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_unsettled', status: 'SUCCEEDED' });

      await refundOrVoidPayment(booking.id, 'Worker never arrived');
      await settleWorkerEarnings(payment.id);

      const payout = await prisma.payout.findUnique({ where: { paymentId: payment.id } });
      expect(payout).toBeNull();
    });

    it('cancels a queued (PENDING) payout before refunding', async () => {
      const { booking, payout } = await seedPaidOnline('PENDING');
      (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_queued', status: 'SUCCEEDED' });

      await refundOrVoidPayment(booking.id, 'Worker never arrived');

      const updated = await prisma.payout.findUnique({ where: { id: payout!.id } });
      expect(updated?.status).toBe('CANCELLED');
      expect(cancelPayout).not.toHaveBeenCalled();
    });

    it('cancels a FAILED payout so an admin retry cannot send it later', async () => {
      const { booking, payout } = await seedPaidOnline('FAILED');
      (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_failed_payout', status: 'SUCCEEDED' });

      await refundOrVoidPayment(booking.id, 'Worker never arrived');

      const updated = await prisma.payout.findUnique({ where: { id: payout!.id } });
      expect(updated?.status).toBe('CANCELLED');
    });

    it('cancels an in-flight payout at Xendit before refunding', async () => {
      const { booking, payment, payout } = await seedPaidOnline('PROCESSING', `disb_inflight_${Date.now()}`);
      (cancelPayout as jest.Mock).mockResolvedValueOnce({ id: payout!.xenditDisbursementId, status: 'CANCELLED' });
      (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_inflight', status: 'SUCCEEDED' });

      await refundOrVoidPayment(booking.id, 'Worker never arrived');

      expect(cancelPayout).toHaveBeenCalledWith(payout!.xenditDisbursementId);
      const updated = await prisma.payout.findUnique({ where: { id: payout!.id } });
      expect(updated?.status).toBe('CANCELLED');
      const refunded = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(refunded?.status).toBe('REFUNDED');
    });

    it('refuses the refund when Xendit has already sent the in-flight payout', async () => {
      const { booking, payment, payout } = await seedPaidOnline('PROCESSING', `disb_sent_${Date.now()}`);
      (cancelPayout as jest.Mock).mockRejectedValueOnce(new Error('Payout can no longer be cancelled'));
      (retrievePayout as jest.Mock).mockResolvedValueOnce({ id: payout!.xenditDisbursementId, status: 'SUCCEEDED' });

      await expect(refundOrVoidPayment(booking.id, 'Worker never arrived')).rejects.toThrow(/manual clawback/);

      expect(createRefund).not.toHaveBeenCalled();
      const updated = await prisma.payout.findUnique({ where: { id: payout!.id } });
      expect(updated?.status).toBe('PAID');
      const unchanged = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(unchanged?.status).toBe('COMPLETED');
    });

    it('refuses the refund while the payout worker is mid-send (no Xendit id yet)', async () => {
      const { booking } = await seedPaidOnline('PROCESSING');

      await expect(refundOrVoidPayment(booking.id, 'Worker never arrived')).rejects.toThrow(/being sent right now/);

      expect(createRefund).not.toHaveBeenCalled();
    });

    it('refuses the refund when the payout is already PAID', async () => {
      const { booking } = await seedPaidOnline('PAID');

      await expect(refundOrVoidPayment(booking.id, 'Worker never arrived')).rejects.toThrow(/manual clawback/);

      expect(createRefund).not.toHaveBeenCalled();
    });
  });

  describe('reconcilePendingRefund (sweep)', () => {
    it('reopens the payment and logs an error when a PENDING refund later fails', async () => {
      const { payment } = await seedPayment({
        status: 'REFUNDED',
        escrowStatus: 'REFUNDED',
        xenditInvoiceId: `inv_rec_${Date.now()}`,
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: { xenditRefundId: 'refund_later_failed', xenditRefundStatus: 'PENDING', refundedAt: new Date() },
      });
      (retrieveRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_later_failed', status: 'FAILED', failure_code: 'INSUFFICIENT_BALANCE' });

      await expect(reconcilePendingRefund(payment.id)).resolves.toBe('failed');

      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.xenditRefundStatus).toBe('FAILED');
      const alert = await prisma.auditLog.findFirst({
        where: { action: 'REFUND_FAILED', metadata: { path: ['paymentId'], equals: payment.id } },
      });
      expect(alert).not.toBeNull();
    });

    it('marks a PENDING refund SUCCEEDED once Xendit completes it', async () => {
      const { payment } = await seedPayment({ status: 'REFUNDED', escrowStatus: 'REFUNDED' });
      await prisma.payment.update({
        where: { id: payment.id },
        data: { xenditRefundId: 'refund_later_ok', xenditRefundStatus: 'PENDING', refundedAt: new Date() },
      });
      (retrieveRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_later_ok', status: 'SUCCEEDED' });

      await expect(reconcilePendingRefund(payment.id)).resolves.toBe('succeeded');

      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.status).toBe('REFUNDED');
      expect(updated?.xenditRefundStatus).toBe('SUCCEEDED');
    });
  });
});
