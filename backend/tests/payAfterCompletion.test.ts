jest.mock('@services/xenditService', () => ({
  ...jest.requireActual('@services/xenditService'),
  createInvoice: jest.fn(),
  retrieveInvoice: jest.fn(),
}));

jest.mock('@queues/payoutQueue', () => ({
  PAYOUT_QUEUE_NAME: 'worker-payout',
  PAYOUT_JOB_NAMES: { SEND_PAYOUT: 'send-payout' },
  schedulePayout: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import {
  settleCashBooking,
  createCompletionInvoice,
  finalizePaidBooking,
} from '@services/paymentLifecycleService';
import { releaseDebtHold } from '@services/debtLedgerService';
import { createTestUser, deleteTestUser, deleteTestBooking } from './helpers';

const { createInvoice } = require('@services/xenditService');
const { schedulePayout } = require('@queues/payoutQueue');

// All call sites below invoice a freshly-seeded booking with no prior Payment
// row, so the alreadyPaid self-heal branch never applies here — narrow it away.
function expectInvoice(result: Awaited<ReturnType<typeof createCompletionInvoice>>) {
  if ('alreadyPaid' in result) throw new Error('Expected a fresh invoice, got alreadyPaid');
  return result;
}

describe('Pay-after-completion payment lifecycle', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientId: string;
  let workerId: string;
  let workerProfileId: string;
  let workerToken: string;

  beforeAll(async () => {
    const { user: client } = await createTestUser('pac-client', { role: 'CLIENT' });
    const { user: worker, plainPassword: workerPw } = await createTestUser('pac-worker', { role: 'WORKER' });
    createdUserIds.push(client.id, worker.id);
    clientId = client.id;
    workerId = worker.id;

    const profile = await prisma.workerProfile.update({
      where: { userId: workerId },
      data: { payoutMethod: 'GCASH', payoutAccountName: 'Test Worker', payoutAccountNumber: '09171234567' },
    });
    workerProfileId = profile.id;

    const workerLogin = await request(app).post('/api/auth/login').send({ email: worker.email, password: workerPw });
    workerToken = workerLogin.body.data.token;
  });

  afterAll(async () => {
    for (const id of createdBookingIds) await deleteTestBooking(id);
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    (createInvoice as jest.Mock).mockReset();
    (schedulePayout as jest.Mock).mockClear();
    await prisma.workerProfile.update({
      where: { id: workerProfileId },
      data: { commissionOwed: 0, debtHoldAt: null, debtHoldNote: null },
    });
  });

  async function seedPendingCompletion(method: 'GCASH' | 'MAYA' | 'CASH', estimatedPrice = 1000) {
    const booking = await prisma.booking.create({
      data: {
        clientId,
        workerId,
        serviceType: 'Cleaning',
        description: 'e2e pac booking',
        location: '123 Test St',
        city: 'Manila',
        scheduledDate: new Date(Date.now() + 86_400_000 + Math.random() * 1e10),
        timeSlot: 'MORNING',
        estimatedPrice,
        finalPrice: estimatedPrice,
        tip: 0,
        paymentMethodType: method,
        status: 'PENDING_COMPLETION',
        workerCompletedAt: new Date(),
      },
    });
    createdBookingIds.push(booking.id);
    return booking;
  }

  it('CASH: finalizes immediately, accrues worker commission debt, creates no payout', async () => {
    const booking = await seedPendingCompletion('CASH', 1000);

    await settleCashBooking(booking.id);

    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(updatedBooking?.status).toBe('COMPLETED');

    const payment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
    expect(payment?.status).toBe('COMPLETED');
    expect(payment?.methodType).toBe('CASH');

    // 10% commission + 2% withholding on the post-commission amount = 100 + 18
    const platformCut = payment!.commissionAmount + payment!.withholdingTaxAmount;
    const workerProfile = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });
    expect(workerProfile.commissionOwed).toBeCloseTo(platformCut, 2);

    const payout = await prisma.payout.findUnique({ where: { paymentId: payment!.id } });
    expect(payout).toBeNull();
    expect(schedulePayout).not.toHaveBeenCalled();
  });

  it('GCASH: raises a Xendit invoice and moves the booking to AWAITING_PAYMENT', async () => {
    const booking = await seedPendingCompletion('GCASH', 1000);
    (createInvoice as jest.Mock).mockResolvedValueOnce({
      id: 'inv_pac_1',
      status: 'PENDING',
      invoiceUrl: 'https://checkout.xendit.co/inv_pac_1',
    });

    const result = expectInvoice(await createCompletionInvoice(booking.id));
    expect(result.checkoutUrl).toContain('inv_pac_1');
    expect(createInvoice).toHaveBeenCalledWith(expect.objectContaining({ amountPesos: 1000 }));

    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(updatedBooking?.status).toBe('AWAITING_PAYMENT');

    const payment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
    expect(payment?.status).toBe('PENDING');
    expect(payment?.xenditInvoiceId).toBe('inv_pac_1');
  });

  it('GCASH: resuming checkout after a missed webhook self-heals instead of raising a duplicate invoice', async () => {
    const booking = await seedPendingCompletion('GCASH', 1000);
    (createInvoice as jest.Mock).mockResolvedValueOnce({
      id: 'inv_pac_resume',
      status: 'PENDING',
      invoiceUrl: 'https://checkout.xendit.co/inv_pac_resume',
    });
    await createCompletionInvoice(booking.id);

    // Xendit shows PAID (the client actually completed checkout), but the
    // invoice-paid webhook never landed, so the local Payment is still PENDING.
    const { retrieveInvoice } = require('@services/xenditService');
    (retrieveInvoice as jest.Mock).mockResolvedValueOnce({
      status: 'PAID',
      payment_id: 'xnd_pay_resume',
      paid_amount: 1000,
      paid_at: new Date().toISOString(),
    });

    const result = await createCompletionInvoice(booking.id);
    expect(result).toEqual({ alreadyPaid: true });
    // Must not have minted a second invoice.
    expect(createInvoice).toHaveBeenCalledTimes(1);

    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(updatedBooking?.status).toBe('COMPLETED');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe('COMPLETED');
    expect(payment.xenditPaymentId).toBe('xnd_pay_resume');
  });

  it('GCASH: invoice-paid finalize completes the booking and schedules the full payout', async () => {
    const booking = await seedPendingCompletion('GCASH', 1000);
    (createInvoice as jest.Mock).mockResolvedValueOnce({
      id: 'inv_pac_2',
      status: 'PENDING',
      invoiceUrl: 'https://checkout.xendit.co/inv_pac_2',
    });
    const { paymentId } = expectInvoice(await createCompletionInvoice(booking.id));

    await finalizePaidBooking(paymentId, 'ewc_pac_2', 1000, new Date());

    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(updatedBooking?.status).toBe('COMPLETED');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('COMPLETED');

    const payout = await prisma.payout.findUnique({ where: { paymentId } });
    expect(payout?.amount).toBeCloseTo(payment.workerPayout, 2);
    expect(schedulePayout).toHaveBeenCalledWith(payout!.id);
  });

  it('GCASH: outstanding commission dues are netted out of the payout', async () => {
    await prisma.workerProfile.update({ where: { id: workerProfileId }, data: { commissionOwed: 200 } });

    const booking = await seedPendingCompletion('GCASH', 1000);
    (createInvoice as jest.Mock).mockResolvedValueOnce({
      id: 'inv_pac_3',
      status: 'PENDING',
      invoiceUrl: 'https://checkout.xendit.co/inv_pac_3',
    });
    const { paymentId } = expectInvoice(await createCompletionInvoice(booking.id));

    await finalizePaidBooking(paymentId, 'ewc_pac_3', 1000, new Date());

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const payout = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
    expect(payout.amount).toBeCloseTo(payment.workerPayout - 200, 2);

    const workerProfile = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });
    expect(workerProfile.commissionOwed).toBeCloseTo(0, 2);

    const recovery = await prisma.debtLedgerEntry.findFirst({
      where: { workerProfileId, type: 'DEBT_RECOVERY' },
      orderBy: { createdAt: 'desc' },
    });
    expect(recovery?.amount).toBeCloseTo(-200, 2);
  });

  it('GCASH: dues larger than the payout absorb it entirely, no payout row', async () => {
    await prisma.workerProfile.update({ where: { id: workerProfileId }, data: { commissionOwed: 5000 } });

    const booking = await seedPendingCompletion('GCASH', 1000);
    (createInvoice as jest.Mock).mockResolvedValueOnce({
      id: 'inv_pac_4',
      status: 'PENDING',
      invoiceUrl: 'https://checkout.xendit.co/inv_pac_4',
    });
    const { paymentId } = expectInvoice(await createCompletionInvoice(booking.id));

    await finalizePaidBooking(paymentId, 'ewc_pac_4', 1000, new Date());

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const payout = await prisma.payout.findUnique({ where: { paymentId } });
    expect(payout).toBeNull();

    const workerProfile = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });
    expect(workerProfile.commissionOwed).toBeCloseTo(5000 - payment.workerPayout, 2);
  });

  it('finalizePaidBooking is idempotent (a replayed webhook does not double-pay)', async () => {
    const booking = await seedPendingCompletion('GCASH', 1000);
    (createInvoice as jest.Mock).mockResolvedValueOnce({
      id: 'inv_pac_5',
      status: 'PENDING',
      invoiceUrl: 'https://checkout.xendit.co/inv_pac_5',
    });
    const { paymentId } = expectInvoice(await createCompletionInvoice(booking.id));

    await finalizePaidBooking(paymentId, 'ewc_pac_5', 1000, new Date());
    (schedulePayout as jest.Mock).mockClear();
    await finalizePaidBooking(paymentId, 'ewc_pac_5', 1000, new Date());

    const payouts = await prisma.payout.findMany({ where: { paymentId } });
    expect(payouts).toHaveLength(1);
    expect(schedulePayout).not.toHaveBeenCalled();
  });

  describe('Debt hold', () => {
    it('crossing the AppSettings.workerDebtHoldLimit puts the account on hold', async () => {
      // Default workerDebtHoldLimit is 500; a 5000-peso cash job accrues
      // ~590 in commission + withholding tax, well past the threshold.
      const booking = await seedPendingCompletion('CASH', 5000);

      await settleCashBooking(booking.id);

      const workerProfile = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });
      expect(workerProfile.commissionOwed).toBeGreaterThan(500);
      expect(workerProfile.debtHoldAt).not.toBeNull();
    });

    it('a held worker gets 402 on PATCH /api/bookings/:id/accept', async () => {
      await prisma.workerProfile.update({
        where: { id: workerProfileId },
        data: { commissionOwed: 600, debtHoldAt: new Date() },
      });
      const booking = await prisma.booking.create({
        data: {
          clientId,
          workerId,
          serviceType: 'Cleaning',
          description: 'held-worker accept attempt',
          location: '123 Test St',
          city: 'Manila',
          scheduledDate: new Date(Date.now() + 86_400_000 + Math.random() * 1e10),
          timeSlot: 'AFTERNOON',
          estimatedPrice: 1000,
          paymentMethodType: 'CASH',
          status: 'PENDING',
        },
      });
      createdBookingIds.push(booking.id);

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/accept`)
        .set('Authorization', `Bearer ${workerToken}`);

      expect(res.status).toBe(402);

      const unchanged = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(unchanged?.status).toBe('PENDING');
    });

    it('releaseDebtHold clears the hold so the worker can accept again', async () => {
      await prisma.workerProfile.update({
        where: { id: workerProfileId },
        data: { commissionOwed: 600, debtHoldAt: new Date() },
      });

      await releaseDebtHold(workerProfileId, 'Worker paid down the balance in person');

      const released = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerProfileId } });
      expect(released.debtHoldAt).toBeNull();
      // Releasing the hold does not itself forgive the debt.
      expect(released.commissionOwed).toBeCloseTo(600, 2);

      const booking = await prisma.booking.create({
        data: {
          clientId,
          workerId,
          serviceType: 'Cleaning',
          description: 'post-release accept attempt',
          location: '123 Test St',
          city: 'Manila',
          scheduledDate: new Date(Date.now() + 86_400_000 + Math.random() * 1e10),
          timeSlot: 'EVENING',
          estimatedPrice: 1000,
          paymentMethodType: 'CASH',
          status: 'PENDING',
        },
      });
      createdBookingIds.push(booking.id);

      const res = await request(app)
        .patch(`/api/bookings/${booking.id}/accept`)
        .set('Authorization', `Bearer ${workerToken}`);

      expect(res.status).toBe(200);
    });
  });
});
