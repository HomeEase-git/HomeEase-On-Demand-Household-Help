jest.mock('@services/xenditService', () => ({
  ...jest.requireActual('@services/xenditService'),
  createRefund: jest.fn(),
  retrieveRefund: jest.fn(),
}));

jest.mock('@queues/payoutQueue', () => ({
  ...jest.requireActual('@queues/payoutQueue'),
  schedulePayout: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '@config/database';
import {
  refundOrVoidPayment,
  reconcilePendingRefund,
  settleWorkerEarnings,
} from '@services/paymentLifecycleService';
import {
  accrueDebtTx,
  recoverDebtTx,
  adminAdjustDebt,
  DuesAdjustmentError,
} from '@services/debtLedgerService';
import { createTestUser, deleteTestUser, createTestBooking, deleteTestBooking } from './helpers';

const { createRefund, retrieveRefund } = require('@services/xenditService');

describe('Worker dues ledger', () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let clientId: string;
  let workerId: string;
  let workerProfileId: string;

  beforeAll(async () => {
    const { user: client } = await createTestUser('dues-client', { role: 'CLIENT' });
    const { user: worker } = await createTestUser('dues-worker', { role: 'WORKER' });
    createdUserIds.push(client.id, worker.id);
    clientId = client.id;
    workerId = worker.id;
    const profile = await prisma.workerProfile.update({
      where: { userId: worker.id },
      data: { payoutMethod: 'GCASH', payoutAccountNumber: '09171234567', payoutAccountName: 'Dues Worker' },
    });
    workerProfileId = profile.id;
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

  beforeEach(async () => {
    (createRefund as jest.Mock).mockReset();
    (retrieveRefund as jest.Mock).mockReset();
    await prisma.debtLedgerEntry.deleteMany({ where: { workerProfileId } });
    await prisma.workerProfile.update({
      where: { id: workerProfileId },
      data: { commissionOwed: 0, compensationCredit: 0, debtHoldAt: null },
    });
  });

  async function setDues(commissionOwed: number, compensationCredit = 0) {
    await prisma.workerProfile.update({ where: { id: workerProfileId }, data: { commissionOwed, compensationCredit } });
  }

  async function dues() {
    return prisma.workerProfile.findUniqueOrThrow({
      where: { id: workerProfileId },
      select: { commissionOwed: true, compensationCredit: true },
    });
  }

  async function seedPayment(methodType: 'GCASH' | 'CASH') {
    const booking = await createTestBooking({ clientId, workerId, status: 'COMPLETED' });
    createdBookingIds.push(booking.id);
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        subtotal: 1000,
        commissionAmount: 100,
        withholdingTaxAmount: 18,
        workerPayout: 882,
        totalAmount: 1000,
        capturedAmount: 1000,
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        methodType,
        xenditInvoiceId: methodType === 'CASH' ? null : `inv_dues_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ...(methodType === 'CASH' ? { workerSettledAt: new Date() } : {}),
      },
    });
    return { booking, payment };
  }

  it('keeps every concurrent charge and recovery (no lost updates)', async () => {
    await setDues(1000);

    // They queue on the row lock, so give them longer than the default 2s
    // to get a pooled connection.
    const txOpts = { maxWait: 30_000, timeout: 30_000 };
    await Promise.all([
      ...Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) => recoverDebtTx(tx, workerProfileId, 50, { note: 'test recovery' }), txOpts)
      ),
      ...Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) => accrueDebtTx(tx, workerProfileId, 30, { note: 'test charge' }), txOpts)
      ),
    ]);

    const { commissionOwed } = await dues();
    expect(commissionOwed).toBeCloseTo(1000 - 250 + 150, 2);
    const ledger = await prisma.debtLedgerEntry.aggregate({ where: { workerProfileId }, _sum: { amount: true } });
    expect(ledger._sum.amount).toBeCloseTo(-250 + 150, 2);
  });

  it('turns a cash-job reversal beyond what is owed into payout credit instead of dropping it', async () => {
    // The cash job's ₱118 dues were already recovered from an online payout.
    await setDues(0);
    const { booking } = await seedPayment('CASH');

    await refundOrVoidPayment(booking.id, 'Client complaint upheld');

    const after = await dues();
    expect(after.commissionOwed).toBe(0);
    expect(after.compensationCredit).toBeCloseTo(118, 2);
    const entry = await prisma.debtLedgerEntry.findFirst({ where: { workerProfileId, bookingId: booking.id } });
    expect(entry?.type).toBe('REVERSAL');
    expect(entry?.amount).toBeCloseTo(0, 2);
    expect(entry?.note).toMatch(/118\.00 beyond what was owed/);
  });

  it('splits a partial reversal between the balance and payout credit', async () => {
    await setDues(40);
    const { booking } = await seedPayment('CASH');

    await refundOrVoidPayment(booking.id, 'Client complaint upheld');

    const after = await dues();
    expect(after.commissionOwed).toBe(0);
    expect(after.compensationCredit).toBeCloseTo(78, 2);
  });

  it('reverses a cash job only once when the refund is triggered twice at the same time', async () => {
    await setDues(500);
    const { booking } = await seedPayment('CASH');

    await Promise.all([
      refundOrVoidPayment(booking.id, 'Admin cancel'),
      refundOrVoidPayment(booking.id, 'Dispute resolution'),
    ]);

    expect((await dues()).commissionOwed).toBeCloseTo(500 - 118, 2);
  });

  it('puts netted dues and ridden-along compensation back when an online job is refunded', async () => {
    await setDues(300, 50);
    const { booking, payment } = await seedPayment('GCASH');

    await settleWorkerEarnings(payment.id);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(payout.amount).toBeCloseTo(882 - 300 + 50, 2);
    expect(await dues()).toEqual({ commissionOwed: 0, compensationCredit: 0 });
    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(settled.compensationPaid).toBeCloseTo(50, 2);

    (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_dues', status: 'SUCCEEDED' });
    await refundOrVoidPayment(booking.id, 'Worker never arrived');

    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('CANCELLED');
    const after = await dues();
    expect(after.commissionOwed).toBeCloseTo(300, 2);
    expect(after.compensationCredit).toBeCloseTo(50, 2);
    const putBack = await prisma.debtLedgerEntry.findFirst({
      where: { workerProfileId, bookingId: booking.id, type: 'RECOVERY_REVERSED' },
    });
    expect(putBack?.amount).toBeCloseTo(300, 2);
  });

  it('restores the settlement only once even if a failed refund is retried', async () => {
    await setDues(300);
    const { booking, payment } = await seedPayment('GCASH');
    await settleWorkerEarnings(payment.id);

    // Xendit accepts the refund as PENDING, then it fails; the sweep reopens the payment.
    (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_first', status: 'PENDING' });
    await refundOrVoidPayment(booking.id, 'Worker never arrived');
    (retrieveRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_first', status: 'FAILED' });
    await reconcilePendingRefund(payment.id);

    (retrieveRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_first', status: 'FAILED' });
    (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'refund_second', status: 'SUCCEEDED' });
    await refundOrVoidPayment(booking.id, 'Worker never arrived');

    expect((await dues()).commissionOwed).toBeCloseTo(300, 2);
    const putBacks = await prisma.debtLedgerEntry.count({
      where: { workerProfileId, bookingId: booking.id, type: 'RECOVERY_REVERSED' },
    });
    expect(putBacks).toBe(1);
  });

  it('refuses an admin waiver larger than what the worker owes', async () => {
    await setDues(100);

    await expect(adminAdjustDebt(workerProfileId, 500, 'Goodwill')).rejects.toBeInstanceOf(DuesAdjustmentError);

    expect((await dues()).commissionOwed).toBe(100);
  });

  it('records an admin increase as an ADMIN_ADJUSTMENT, not a cash-job commission', async () => {
    await setDues(0);

    await adminAdjustDebt(workerProfileId, -75, 'Missed cash job');

    const entry = await prisma.debtLedgerEntry.findFirst({ where: { workerProfileId }, orderBy: { createdAt: 'desc' } });
    expect(entry?.type).toBe('ADMIN_ADJUSTMENT');
    expect(entry?.amount).toBe(75);
  });
});
