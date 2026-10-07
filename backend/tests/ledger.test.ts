jest.mock('@services/xenditTransactionsService', () => ({
  ...jest.requireActual('@services/xenditTransactionsService'),
  getXenditBalanceCentavos: jest.fn(),
  listXenditTransactions: jest.fn(),
}));
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
import { finalizePaidBooking, settleCashBooking, refundOrVoidPayment } from '@services/paymentLifecycleService';
import { applyXenditPayoutStatus } from '@services/payoutStatusService';
import { chargePenaltyTx, adminAdjustDebt } from '@services/debtLedgerService';
import { openLedger, LedgerAlreadyOpenError } from '@services/ledgerOpeningService';
import { syncXenditFees } from '@services/ledgerFeeSyncService';
import { buildReconciliation } from '@services/ledgerReconciliationService';
import { postLedger, resetLedgerOpenCache, postCancellationFee, postClientFeeCleared, postRefundSent } from '@services/ledgerService';
import { markPeriodRemitted } from '@services/taxRemittanceService';
import { requestRefund, markRefundedManually } from '@services/refundRequestService';
import { manilaMonthKey } from '@utils/manilaTime';
import { createTestUser, deleteTestUser, createTestBooking } from './helpers';
import { ownerDb } from './ownerDb';

const { getXenditBalanceCentavos, listXenditTransactions } = require('@services/xenditTransactionsService');
const { createRefund } = require('@services/xenditService');

async function wipeLedger() {
  await ownerDb.ledgerLine.deleteMany({});
  await ownerDb.ledgerTransaction.deleteMany({});
  await prisma.ledgerReconciliation.deleteMany({});
  await prisma.ledgerState.deleteMany({});
  resetLedgerOpenCache();
}

/** What the ledger says the platform owes a worker, in centavos. */
async function ledgerOwed(workerId: string) {
  const r = await prisma.ledgerLine.aggregate({ where: { account: 'WORKER_BALANCE', workerId }, _sum: { amountCentavos: true } });
  return 0 - (r._sum.amountCentavos ?? 0);
}

describe('Double-entry ledger', () => {
  const userIds: string[] = [];
  let clientId: string;
  let workerA: string; // online jobs
  let workerB: string; // cash jobs
  let workerBProfileId: string;
  const xenditTx: Array<Record<string, unknown>> = [];
  const savedKey = process.env.XENDIT_SECRET_KEY;

  const tx = (type: string, referenceId: string, cashflow: 'MONEY_IN' | 'MONEY_OUT', amount: number, net: number) => {
    xenditTx.push({ id: `txn_${xenditTx.length}_${Date.now()}`, type, status: 'SUCCESSFUL', referenceId, cashflow, amount, netAmount: net, created: new Date() });
  };

  async function onlinePayment(workerId: string, total: number) {
    const booking = await createTestBooking({ clientId, workerId, status: 'AWAITING_PAYMENT' as never, estimatedPrice: total });
    return prisma.payment.create({
      data: {
        bookingId: booking.id,
        subtotal: total,
        commissionAmount: total * 0.1,
        withholdingTaxAmount: total * 0.018,
        workerPayout: total * 0.882,
        totalAmount: total,
        status: 'PENDING',
        escrowStatus: 'HELD',
        methodType: 'GCASH',
        xenditInvoiceId: `inv_ledger_${booking.id}`,
      },
    });
  }

  beforeAll(async () => {
    process.env.XENDIT_SECRET_KEY = 'xnd_development_ledger_test';
    await wipeLedger();
    const { user: client } = await createTestUser('ledger-client', { role: 'CLIENT' });
    const { user: a } = await createTestUser('ledger-worker-a', { role: 'WORKER' });
    const { user: b } = await createTestUser('ledger-worker-b', { role: 'WORKER' });
    userIds.push(client.id, a.id, b.id);
    clientId = client.id;
    workerA = a.id;
    workerB = b.id;
    await prisma.workerProfile.update({
      where: { userId: a.id },
      // Dues from before the ledger existed, and a payout account.
      data: { commissionOwed: 118, payoutMethod: 'GCASH', payoutAccountNumber: '09170000000', payoutAccountName: 'A' },
    });
    workerBProfileId = (await prisma.workerProfile.findUniqueOrThrow({ where: { userId: b.id } })).id;
    (getXenditBalanceCentavos as jest.Mock).mockResolvedValue(1_000_000);
    (listXenditTransactions as jest.Mock).mockImplementation(async () => xenditTx.map((t) => ({ ...t })));
  });

  afterAll(async () => {
    await wipeLedger();
    for (const id of userIds) await deleteTestUser(id);
    process.env.XENDIT_SECRET_KEY = savedKey;
    await prisma.$disconnect();
  });

  it('posts nothing before the ledger is opened', async () => {
    const posted = await postLedger(prisma, {
      type: 'PENALTY',
      key: 'before-open',
      memo: 'x',
      lines: [
        { account: 'WORKER_BALANCE', amountCentavos: 100, workerId: workerA },
        { account: 'PENALTY_REVENUE', amountCentavos: -100 },
      ],
    });
    expect(posted).toBe(false);
    expect(await prisma.ledgerTransaction.count()).toBe(0);
  });

  it('refuses a posting that does not balance', async () => {
    await expect(
      postLedger(prisma, { type: 'OPENING', key: 'bad', memo: 'x', lines: [{ account: 'XENDIT_CASH', amountCentavos: 100 }] })
    ).rejects.toThrow(/does not balance/);
  });

  it('opens with the balances carried in from before', async () => {
    const result = await openLedger(userIds[0]);
    expect(result.xenditCentavos).toBe(1_000_000);
    // Worker A owed ₱118 of dues before the ledger existed.
    expect(await ledgerOwed(workerA)).toBe(-11800);
    await expect(openLedger(userIds[0])).rejects.toBeInstanceOf(LedgerAlreadyOpenError);
  });

  it('books an online payment, the dues netted from it and the payout sent', async () => {
    const payment = await onlinePayment(workerA, 1000);
    await finalizePaidBooking(payment.id, 'ewc_1', 1000, new Date());
    tx('PAYMENT', payment.id, 'MONEY_IN', 1000, 987.68); // Xendit kept ₱12.32

    // Capture credits the worker ₱882; the ₱118 dues netting needs no entry of its own.
    expect(await ledgerOwed(workerA)).toBe(88200 - 11800);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(payout.amount).toBeCloseTo(764, 2);

    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });
    await applyXenditPayoutStatus(payout, 'SUCCEEDED');
    await applyXenditPayoutStatus(payout, 'SUCCEEDED'); // duplicate webhook
    tx('DISBURSEMENT', payout.id, 'MONEY_OUT', 764, 793.12); // plus ₱29.12 fee

    expect(await ledgerOwed(workerA)).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { type: 'PAYOUT_SENT' } })).toBe(1);
  });

  it('books a cash job, a penalty and a waiver against the worker', async () => {
    const booking = await createTestBooking({ clientId, workerId: workerB, status: 'PENDING_COMPLETION' as never, estimatedPrice: 1000 });
    await settleCashBooking(booking.id);
    await prisma.$transaction((t) => chargePenaltyTx(t, workerBProfileId, 200, { bookingId: booking.id, note: 'No-show' }));
    await adminAdjustDebt(workerBProfileId, 50, 'Goodwill');

    const profile = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerBProfileId } });
    expect(await ledgerOwed(workerB)).toBe(-Math.round(profile.commissionOwed * 100));
  });

  it('books a refund and takes the worker share back off their balance', async () => {
    const payment = await onlinePayment(workerA, 500);
    await finalizePaidBooking(payment.id, 'ewc_2', 500, new Date());
    tx('PAYMENT', payment.id, 'MONEY_IN', 500, 493.84);
    (createRefund as jest.Mock).mockResolvedValueOnce({ id: 'rfd_ledger', status: 'SUCCEEDED' });
    await refundOrVoidPayment(payment.bookingId, 'Client complaint');
    tx('REFUND', payment.id, 'MONEY_OUT', 500, 512.32);

    expect(await ledgerOwed(workerA)).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { type: 'REFUND_SENT', paymentId: payment.id } })).toBe(1);
  });

  it("books Xendit's fees once, however often the sync runs", async () => {
    const first = await syncXenditFees();
    const again = await syncXenditFees();
    expect(first.posted).toBe(4);
    expect(again.posted).toBe(0);
    const fees = await prisma.ledgerLine.aggregate({ where: { account: 'XENDIT_FEES' }, _sum: { amountCentavos: true } });
    expect(fees._sum.amountCentavos).toBe(1232 + 2912 + 616 + 1232);
  });

  it('books a manual refund after the worker was paid as a loss, not against the worker', async () => {
    const payment = await onlinePayment(workerA, 400);
    await finalizePaidBooking(payment.id, 'ewc_3', 400, new Date());
    tx('PAYMENT', payment.id, 'MONEY_IN', 400, 395.07);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { paymentId: payment.id } });
    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });
    await applyXenditPayoutStatus(payout, 'SUCCEEDED');
    tx('DISBURSEMENT', payout.id, 'MONEY_OUT', payout.amount, payout.amount + 29.12);

    const outcome = await requestRefund({ bookingId: payment.bookingId, reason: 'Damage', source: 'ADMIN_CANCEL' });
    if (outcome.kind !== 'requested') throw new Error('expected a request');
    await markRefundedManually(outcome.request.id, userIds[0], 'Paid back via GCash from the office');

    const loss = await prisma.ledgerLine.aggregate({ where: { account: 'REFUND_LOSS' }, _sum: { amountCentavos: true } });
    expect(loss._sum.amountCentavos).toBe(40000 - 4000 - 720);
    expect(await ledgerOwed(workerA)).toBe(0);
  });

  it('books withholding tax remitted to BIR, and only the difference when re-marked', async () => {
    const start = new Date('2035-01-01T00:00:00Z');
    const end = new Date('2035-04-01T00:00:00Z');
    const booking = await createTestBooking({ clientId, workerId: workerB, status: 'COMPLETED' });
    const p = await prisma.payment.create({
      data: { bookingId: booking.id, subtotal: 1000, commissionAmount: 100, withholdingTaxAmount: 18, workerPayout: 882, totalAmount: 1000, status: 'COMPLETED', escrowStatus: 'RELEASED', methodType: 'CASH', capturedAt: new Date('2035-02-01T00:00:00Z') },
    });
    await markPeriodRemitted(start, end, 'OR-1', userIds[0]);
    await prisma.payment.update({ where: { id: p.id }, data: { withholdingTaxAmount: 20 } });
    await markPeriodRemitted(start, end, 'OR-1b', userIds[0]);

    const remitted = await prisma.ledgerLine.aggregate({
      where: { account: 'WITHHOLDING_TAX_PAYABLE', transaction: { type: 'TAX_REMITTED' } },
      _sum: { amountCentavos: true },
    });
    expect(remitted._sum.amountCentavos).toBe(2000);
    await prisma.taxRemittance.deleteMany({ where: { periodStart: start } });
  });

  it('books a cancellation fee owed by the client and credited to the worker, then cleared', async () => {
    await postCancellationFee(prisma, clientId, workerB, 200, { key: 'ledger-test', bookingId: null });
    await postCancellationFee(prisma, clientId, workerB, 200, { key: 'ledger-test', bookingId: null }); // retry
    await postClientFeeCleared(prisma, clientId, 200, 'ledger-test-clear');
    const receivable = await prisma.ledgerLine.aggregate({ where: { account: 'CLIENT_RECEIVABLE', clientId }, _sum: { amountCentavos: true } });
    expect(receivable._sum.amountCentavos).toBe(0);
    // Keep the operational side in step so the worker check below still agrees.
    await prisma.workerProfile.update({ where: { id: workerBProfileId }, data: { commissionOwed: { decrement: 200 } } });
  });

  it('reconciles: balanced, workers agree, Xendit agrees', async () => {
    await syncXenditFees(); // the hourly sweep, for the transactions added since
    const report = await buildReconciliation(manilaMonthKey(new Date()));
    if (!report.opened) throw new Error('expected an open ledger');
    const byKey = Object.fromEntries(report.checks.map((c) => [c.key, c]));
    const failing = report.checks.filter((c) => c.status === 'DIFFERENCE');
    expect(failing.map((c) => `${c.key}: ${c.detail} ${JSON.stringify(c.items ?? [])}`)).toEqual([]);
    expect(byKey.balanced.status).toBe('PASS');
    expect(byKey.workers.status).toBe('PASS');
    expect(byKey.xendit.status).toBe('PASS');
    // Opened this month, so the month-level comparisons aren't meaningful yet.
    expect(byKey.commission.status).toBe('UNAVAILABLE');

    // The books as a whole balance.
    const total = report.accounts.reduce((sum, a) => sum + a.closing, 0);
    expect(total).toBe(0);
  });

  it('flags a Xendit transaction the ledger knows nothing about', async () => {
    tx('DISBURSEMENT', 'someone-elses-transfer', 'MONEY_OUT', 100, 129.12);
    const report = await buildReconciliation(manilaMonthKey(new Date()));
    if (!report.opened) throw new Error('expected an open ledger');
    const xendit = report.checks.find((c) => c.key === 'xendit')!;
    expect(xendit.status).toBe('DIFFERENCE');
    expect(xendit.items?.[0]).toMatchObject({ reference: 'someone-elses-transfer' });
    xenditTx.pop();
  });

  it('flags a worker whose records drift from the ledger', async () => {
    await prisma.workerProfile.update({ where: { userId: workerA }, data: { commissionOwed: 25 } });
    const report = await buildReconciliation(manilaMonthKey(new Date()));
    if (!report.opened) throw new Error('expected an open ledger');
    const workers = report.checks.find((c) => c.key === 'workers')!;
    expect(workers.status).toBe('DIFFERENCE');
    expect(workers.items).toHaveLength(1);
    await prisma.workerProfile.update({ where: { userId: workerA }, data: { commissionOwed: 0 } });
  });

  it('owes an overpayment back to the client instead of crediting the worker', async () => {
    const before = await ledgerOwed(workerA);
    const payment = await onlinePayment(workerA, 1000);
    await finalizePaidBooking(payment.id, 'ewc_over', 1010, new Date());

    // The worker is credited the ₱882 share of the invoice, not of the ₱1,010 paid.
    expect((await ledgerOwed(workerA)) - before).toBe(88200);
    const lines = await prisma.ledgerLine.findMany({ where: { transaction: { paymentId: payment.id } } });
    expect(lines.find((l) => l.account === 'XENDIT_CASH')?.amountCentavos).toBe(101000);
    expect(lines.find((l) => l.account === 'CLIENT_RECEIVABLE')).toMatchObject({ amountCentavos: -1000, clientId });

    // Refunding it in full sends the overpayment back too: nothing is left
    // owed to the client or credited to the worker for this payment.
    await postRefundSent(prisma, await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }), workerA, clientId);
    const sums = await prisma.ledgerLine.groupBy({
      by: ['account'],
      where: { transaction: { paymentId: payment.id } },
      _sum: { amountCentavos: true },
    });
    for (const account of ['XENDIT_CASH', 'WORKER_BALANCE', 'CLIENT_RECEIVABLE'] as const) {
      expect(sums.find((r) => r.account === account)?._sum.amountCentavos ?? 0).toBe(0);
    }
  });
});
