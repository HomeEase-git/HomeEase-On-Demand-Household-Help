import prisma from '@config/database';
import { isLedgerOpen, postXenditFee } from '@services/ledgerService';
import { listXenditTransactions, feeCentavos } from '@services/xenditTransactionsService';

// Xendit transactions can appear a little after the event; re-read this far
// back each run (posting is idempotent per transaction, so overlap is safe).
const OVERLAP_MS = 24 * 60 * 60 * 1000;

const LABEL: Record<string, string> = {
  PAYMENT: 'payment',
  DISBURSEMENT: 'payout',
  REFUND: 'refund',
};

/**
 * Books the fee Xendit charged on each of our payments, payouts and refunds
 * (Xendit takes it straight off the balance). Only transactions that match
 * one of our Payment/Payout ids are booked; anything else — test transfers,
 * Xendit's own batch fee deductions — is left for the monthly reconciliation
 * to list. Hourly via the cron sweep; safe to re-run.
 */
export async function syncXenditFees(): Promise<{ posted: number; unmatched: number; skipped?: string }> {
  if (!(await isLedgerOpen())) return { posted: 0, unmatched: 0, skipped: 'ledger not open' };
  if (!process.env.XENDIT_SECRET_KEY) return { posted: 0, unmatched: 0, skipped: 'Xendit not configured' };

  const state = await prisma.ledgerState.findUniqueOrThrow({ where: { id: 'singleton' } });
  const since = new Date((state.xenditFeesSyncedTo ?? state.openedAt ?? new Date()).getTime() - OVERLAP_MS);
  const floor = state.openedAt ?? since;
  const now = new Date();
  const transactions = await listXenditTransactions(since < floor ? floor : since, now);

  const candidates = transactions.filter((t) => t.status === 'SUCCESSFUL' && LABEL[t.type] && feeCentavos(t) > 0);
  const refs = [...new Set(candidates.map((t) => t.referenceId))];
  const [payments, payouts] = await Promise.all([
    prisma.payment.findMany({ where: { id: { in: refs } }, select: { id: true } }),
    prisma.payout.findMany({ where: { id: { in: refs } }, select: { id: true } }),
  ]);
  const paymentIds = new Set(payments.map((p) => p.id));
  const payoutIds = new Set(payouts.map((p) => p.id));

  let posted = 0;
  let unmatched = 0;
  for (const t of candidates) {
    const isPayout = t.type === 'DISBURSEMENT';
    const known = isPayout ? payoutIds.has(t.referenceId) : paymentIds.has(t.referenceId);
    if (!known) {
      unmatched++;
      continue;
    }
    const didPost = await postXenditFee(prisma, {
      xenditTransactionId: t.id,
      centavos: feeCentavos(t),
      occurredAt: t.created,
      memo: `Xendit fee on ${LABEL[t.type]}`,
      paymentId: isPayout ? null : t.referenceId,
      payoutId: isPayout ? t.referenceId : null,
    });
    if (didPost) posted++;
  }

  await prisma.ledgerState.update({ where: { id: 'singleton' }, data: { xenditFeesSyncedTo: now } });
  return { posted, unmatched };
}
