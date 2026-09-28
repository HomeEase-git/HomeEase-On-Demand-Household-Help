import prisma from '@config/database';
import { postLedger, toCentavos, resetLedgerOpenCache, type LedgerLineInput } from '@services/ledgerService';
import { getXenditBalanceCentavos } from '@services/xenditTransactionsService';

/**
 * What the platform owes each worker right now according to the operational
 * records, in centavos (negative = the worker owes the platform). This is the
 * figure the ledger's WORKER_BALANCE should agree with:
 *   payouts not yet sent (queued, in flight or failed)
 * + payouts stopped for a refund that hasn't completed yet
 * + paid jobs whose earnings haven't been settled into a payout yet
 * + payout credit − dues owed.
 */
export async function expectedWorkerBalances(): Promise<Map<string, number>> {
  const [openPayouts, stoppedPayouts, unsettled, profiles] = await Promise.all([
    prisma.payout.groupBy({
      by: ['workerId'],
      where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
      _sum: { amount: true },
    }),
    prisma.payout.findMany({
      where: { status: 'CANCELLED', payment: { status: 'COMPLETED', settlementReversedAt: null } },
      select: { workerId: true, amount: true },
    }),
    prisma.payment.findMany({
      where: { status: 'COMPLETED', methodType: { in: ['GCASH', 'MAYA'] }, workerSettledAt: null },
      select: { workerPayout: true, booking: { select: { workerId: true } } },
    }),
    prisma.workerProfile.findMany({
      where: { OR: [{ commissionOwed: { not: 0 } }, { compensationCredit: { not: 0 } }] },
      select: { userId: true, commissionOwed: true, compensationCredit: true },
    }),
  ]);

  const owed = new Map<string, number>();
  const add = (workerId: string | null | undefined, centavos: number) => {
    if (!workerId || centavos === 0) return;
    owed.set(workerId, (owed.get(workerId) ?? 0) + centavos);
  };
  for (const p of openPayouts) add(p.workerId, toCentavos(p._sum.amount));
  for (const p of stoppedPayouts) add(p.workerId, toCentavos(p.amount));
  for (const p of unsettled) add(p.booking.workerId, toCentavos(p.workerPayout));
  for (const w of profiles) add(w.userId, toCentavos(w.compensationCredit) - toCentavos(w.commissionOwed));
  return owed;
}

/** Withholding tax captured but not yet recorded as remitted to BIR, in centavos. */
async function unremittedWithholdingCentavos(): Promise<number> {
  const [withheld, remitted] = await Promise.all([
    prisma.payment.aggregate({ where: { status: 'COMPLETED' }, _sum: { withholdingTaxAmount: true } }),
    prisma.taxRemittance.aggregate({ where: { status: { in: ['REMITTED', 'NEEDS_REVIEW'] } }, _sum: { totalTaxWithheld: true } }),
  ]);
  return Math.max(0, toCentavos(withheld._sum.withholdingTaxAmount) - toCentavos(remitted._sum.totalTaxWithheld));
}

export class LedgerAlreadyOpenError extends Error {}

/**
 * Starts the ledger: records, as one OPENING transaction, the balances the
 * platform already had — what each worker is owed or owes, withholding tax
 * not yet remitted, and the Xendit balance (read live; recorded as ₱0 with a
 * warning if Xendit can't be reached). The difference goes to
 * OPENING_BALANCE. Everything after this is posted as it happens.
 */
export async function openLedger(adminId: string) {
  let xenditCentavos = 0;
  let xenditWarning: string | null = null;
  try {
    xenditCentavos = await getXenditBalanceCentavos();
  } catch (error) {
    xenditWarning = `Couldn't read the Xendit balance (${error instanceof Error ? error.message : 'unknown error'}) — opened with ₱0; the reconciliation will show the difference.`;
  }
  const [workerBalances, withholding] = await Promise.all([expectedWorkerBalances(), unremittedWithholdingCentavos()]);

  const lines: LedgerLineInput[] = [
    { account: 'XENDIT_CASH', amountCentavos: xenditCentavos },
    { account: 'WITHHOLDING_TAX_PAYABLE', amountCentavos: -withholding },
    // Owed to a worker is a credit on their balance.
    ...[...workerBalances].map(([workerId, centavos]) => ({ account: 'WORKER_BALANCE' as const, amountCentavos: -centavos, workerId })),
  ];
  const net = lines.reduce((sum, l) => sum + l.amountCentavos, 0);
  lines.push({ account: 'OPENING_BALANCE', amountCentavos: -net });

  const openedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const claim = await tx.ledgerState.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
    if (claim.openedAt) throw new LedgerAlreadyOpenError('The ledger is already open');
    const opened = await tx.ledgerState.updateMany({
      where: { id: 'singleton', openedAt: null },
      data: { openedAt, openedById: adminId, xenditFeesSyncedTo: openedAt },
    });
    if (opened.count === 0) throw new LedgerAlreadyOpenError('The ledger is already open');
    await postLedger(tx, {
      type: 'OPENING',
      key: 'opening',
      occurredAt: openedAt,
      memo: 'Opening balances carried in when the ledger was started',
      lines,
    });
  });
  resetLedgerOpenCache();

  return {
    openedAt,
    xenditCentavos,
    withholdingCentavos: withholding,
    workersCarried: workerBalances.size,
    openingEquityCentavos: -net,
    warning: xenditWarning,
  };
}
