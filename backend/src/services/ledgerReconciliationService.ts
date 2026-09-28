import prisma from '@config/database';
import { Prisma, type LedgerAccount } from '@prisma/client';
import { manilaMidnight } from '@utils/manilaTime';
import { platformRevenue } from '@services/financeReportService';
import { expectedWorkerBalances } from '@services/ledgerOpeningService';
import { listXenditTransactions, balanceEffectCentavos, type XenditTransaction } from '@services/xenditTransactionsService';

/**
 * The month-end check an accountant would do, for one Manila calendar month:
 * account balances (opening, debits, credits, closing) and a set of checks
 * that each either pass or list exactly what doesn't agree.
 */

const ACCOUNTS: LedgerAccount[] = [
  'XENDIT_CASH',
  'MANUAL_SETTLEMENTS',
  'WORKER_BALANCE',
  'CLIENT_RECEIVABLE',
  'COMMISSION_REVENUE',
  'PENALTY_REVENUE',
  'WITHHOLDING_TAX_PAYABLE',
  'XENDIT_FEES',
  'PLATFORM_FUNDED_EXPENSE',
  'REFUND_LOSS',
  'ADJUSTMENTS',
  'OPENING_BALANCE',
];

export interface ReconciliationCheck {
  key: string;
  label: string;
  status: 'PASS' | 'DIFFERENCE' | 'UNAVAILABLE';
  detail: string;
  items?: Array<Record<string, string | number | null>>;
}

export function monthRange(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  return {
    start: manilaMidnight(year, mon),
    end: mon === 12 ? manilaMidnight(year + 1, 1) : manilaMidnight(year, mon + 1),
  };
}

const peso = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function sumByAccount(where: Prisma.LedgerLineWhereInput) {
  const rows = await prisma.ledgerLine.groupBy({ by: ['account'], where, _sum: { amountCentavos: true } });
  return new Map(rows.map((r) => [r.account, r._sum.amountCentavos ?? 0]));
}

export async function buildReconciliation(month: string) {
  const range = monthRange(month);
  if (!range) throw new Error('month must be YYYY-MM');
  const { start, end } = range;
  const state = await prisma.ledgerState.findUnique({ where: { id: 'singleton' } });
  if (!state?.openedAt) return { month, opened: false as const };

  const inMonth = { transaction: { occurredAt: { gte: start, lt: end } } };
  const [before, debitRows, creditRows] = await Promise.all([
    sumByAccount({ transaction: { occurredAt: { lt: start } } }),
    prisma.ledgerLine.groupBy({ by: ['account'], where: { ...inMonth, amountCentavos: { gt: 0 } }, _sum: { amountCentavos: true } }),
    prisma.ledgerLine.groupBy({ by: ['account'], where: { ...inMonth, amountCentavos: { lt: 0 } }, _sum: { amountCentavos: true } }),
  ]);
  const debits = new Map(debitRows.map((r) => [r.account, r._sum.amountCentavos ?? 0]));
  const credits = new Map(creditRows.map((r) => [r.account, -(r._sum.amountCentavos ?? 0)]));
  const accounts = ACCOUNTS.map((account) => {
    const opening = before.get(account) ?? 0;
    const debit = debits.get(account) ?? 0;
    const credit = credits.get(account) ?? 0;
    return { account, opening, debits: debit, credits: credit, closing: opening + debit - credit };
  });

  const checks: ReconciliationCheck[] = [];

  // 1. Every transaction balances.
  const unbalanced = await prisma.$queryRaw<Array<{ id: string; memo: string; off: bigint }>>(Prisma.sql`
    SELECT t.id, t.memo, SUM(l."amountCentavos") AS off
    FROM "LedgerTransaction" t JOIN "LedgerLine" l ON l."transactionId" = t.id
    GROUP BY t.id, t.memo HAVING SUM(l."amountCentavos") <> 0 LIMIT 50`);
  checks.push({
    key: 'balanced',
    label: 'Every transaction balances (debits = credits)',
    status: unbalanced.length === 0 ? 'PASS' : 'DIFFERENCE',
    detail: unbalanced.length === 0 ? 'All transactions balance to the centavo.' : `${unbalanced.length} transaction(s) don't balance.`,
    items: unbalanced.map((u) => ({ transaction: u.id, memo: u.memo, offBy: peso(Number(u.off)) })),
  });

  // 2. Xendit: the ledger's cash movement vs Xendit's own transaction list.
  checks.push(await checkXendit(start, end));

  // 3. Commission vs the revenue report (only meaningful for whole months after opening).
  const ledgerCommission = (credits.get('COMMISSION_REVENUE') ?? 0) - (debits.get('COMMISSION_REVENUE') ?? 0);
  if (state.openedAt > start) {
    checks.push({
      key: 'commission',
      label: 'Commission matches the revenue report',
      status: 'UNAVAILABLE',
      detail: 'The ledger was opened partway through this month, so it only has part of the month.',
    });
  } else {
    const report = await platformRevenue({ gte: start, lt: end });
    const reportCentavos = Math.round(report.revenue * 100);
    checks.push({
      key: 'commission',
      label: 'Commission matches the revenue report',
      status: Math.abs(reportCentavos - ledgerCommission) <= 1 ? 'PASS' : 'DIFFERENCE',
      detail: `Ledger ${peso(ledgerCommission)} · revenue report ${peso(reportCentavos)}.`,
    });
  }

  // 4. Worker balances: ledger vs what the operational records say is owed (as of now).
  const [ledgerWorkers, expected] = await Promise.all([
    prisma.ledgerLine.groupBy({ by: ['workerId'], where: { account: 'WORKER_BALANCE' }, _sum: { amountCentavos: true } }),
    expectedWorkerBalances(),
  ]);
  const ledgerOwed = new Map(ledgerWorkers.map((w) => [w.workerId as string, -(w._sum.amountCentavos ?? 0)]));
  const workerIds = new Set([...ledgerOwed.keys(), ...expected.keys()]);
  const mismatches: Array<{ workerId: string; ledger: number; expected: number }> = [];
  for (const id of workerIds) {
    const l = ledgerOwed.get(id) ?? 0;
    const e = expected.get(id) ?? 0;
    if (Math.abs(l - e) > 1) mismatches.push({ workerId: id, ledger: l, expected: e });
  }
  const names = await prisma.user.findMany({ where: { id: { in: mismatches.map((m) => m.workerId) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(names.map((n) => [n.id, n.fullName]));
  checks.push({
    key: 'workers',
    label: "Each worker's balance matches their dues, credit and unpaid payouts (as of now)",
    status: mismatches.length === 0 ? 'PASS' : 'DIFFERENCE',
    detail:
      mismatches.length === 0
        ? `${workerIds.size} worker balance(s) agree.`
        : `${mismatches.length} worker(s) differ. A refund still in progress can show a temporary difference.`,
    items: mismatches.map((m) => ({
      worker: nameOf.get(m.workerId) ?? m.workerId,
      ledgerOwedToWorker: peso(m.ledger),
      recordsOwedToWorker: peso(m.expected),
      difference: peso(m.ledger - m.expected),
    })),
  });

  // 5. Withholding tax booked in the month vs captured in the month.
  const whtBooked = await prisma.ledgerLine.aggregate({
    where: { ...inMonth, account: 'WITHHOLDING_TAX_PAYABLE', transaction: { occurredAt: { gte: start, lt: end }, type: { in: ['PAYMENT_CAPTURED', 'CASH_JOB_SETTLED', 'PLATFORM_FUNDED'] } } },
    _sum: { amountCentavos: true },
  });
  const whtCaptured = await prisma.payment.aggregate({
    where: { status: { in: ['COMPLETED', 'REFUNDED'] }, capturedAt: { gte: start, lt: end } },
    _sum: { withholdingTaxAmount: true },
  });
  const booked = -(whtBooked._sum.amountCentavos ?? 0);
  const captured = Math.round((whtCaptured._sum.withholdingTaxAmount ?? 0) * 100);
  checks.push({
    key: 'withholding',
    label: 'Withholding tax booked matches tax withheld on payments',
    status: state.openedAt > start ? 'UNAVAILABLE' : Math.abs(booked - captured) <= 1 ? 'PASS' : 'DIFFERENCE',
    detail:
      state.openedAt > start
        ? 'The ledger was opened partway through this month.'
        : `Ledger ${peso(booked)} · payments ${peso(captured)}.`,
  });

  return {
    month,
    opened: true as const,
    openedAt: state.openedAt,
    xenditFeesSyncedTo: state.xenditFeesSyncedTo,
    period: { start, end },
    accounts,
    checks,
    allChecksPassed: checks.every((c) => c.status !== 'DIFFERENCE'),
  };
}

async function checkXendit(start: Date, end: Date): Promise<ReconciliationCheck> {
  const label = "Xendit cash matches Xendit's own records";
  if (!process.env.XENDIT_SECRET_KEY) {
    return { key: 'xendit', label, status: 'UNAVAILABLE', detail: 'Xendit is not configured on this server.' };
  }
  let transactions: XenditTransaction[];
  try {
    transactions = (await listXenditTransactions(start, end)).filter((t) => t.status === 'SUCCESSFUL');
  } catch (error) {
    return {
      key: 'xendit',
      label,
      status: 'UNAVAILABLE',
      detail: `Couldn't reach Xendit: ${error instanceof Error ? error.message : 'unknown error'}.`,
    };
  }

  const xenditNet = transactions.reduce((sum, t) => sum + balanceEffectCentavos(t), 0);
  // The opening balance isn't a Xendit movement, so it's left out here.
  const ledgerCash = await prisma.ledgerLine.aggregate({
    where: { account: 'XENDIT_CASH', transaction: { occurredAt: { gte: start, lt: end }, type: { not: 'OPENING' } } },
    _sum: { amountCentavos: true },
  });
  const ledgerNet = ledgerCash._sum.amountCentavos ?? 0;

  // Which Xendit movements have a matching ledger posting?
  const keysFor = (t: XenditTransaction) =>
    t.type === 'PAYMENT'
      ? [`capture:${t.referenceId}`]
      : t.type === 'DISBURSEMENT'
        ? [`payout:${t.referenceId}`]
        : t.type === 'REFUND'
          ? [`refund:${t.referenceId}`]
          : [];
  const wanted = transactions.flatMap(keysFor);
  const found = new Set(
    (
      await prisma.ledgerTransaction.findMany({ where: { idempotencyKey: { in: wanted } }, select: { idempotencyKey: true } })
    ).map((t) => t.idempotencyKey)
  );
  const unmatched = transactions.filter((t) => {
    const keys = keysFor(t);
    return keys.length === 0 || !keys.every((k) => found.has(k));
  });

  const difference = ledgerNet - xenditNet;
  return {
    key: 'xendit',
    label,
    status: Math.abs(difference) <= 1 && unmatched.length === 0 ? 'PASS' : 'DIFFERENCE',
    detail: `This month: ledger ${peso(ledgerNet)} · Xendit ${peso(xenditNet)} (difference ${peso(difference)}). ${unmatched.length} Xendit transaction(s) with no matching posting.`,
    items: unmatched.slice(0, 100).map((t) => ({
      xenditTransaction: t.id,
      type: t.type,
      reference: t.referenceId,
      amount: peso(Math.round(t.amount * 100)),
      effectOnBalance: peso(balanceEffectCentavos(t)),
      date: t.created.toISOString(),
    })),
  };
}
