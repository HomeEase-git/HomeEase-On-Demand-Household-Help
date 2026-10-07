import prisma from '@config/database';
import { Prisma, type LedgerAccount, type LedgerEventType } from '@prisma/client';

/**
 * Double-entry ledger of the platform's money, in whole centavos.
 *
 * Every event that moves money posts one balanced transaction (lines sum to
 * exactly zero; debits positive, credits negative) under a unique key, so a
 * retried webhook, sweep or admin click can never post the same money twice.
 * Nothing is posted until an admin opens the ledger (ledgerOpeningService),
 * which records the balances carried in from before.
 *
 * Accounts, from the platform's point of view:
 *  - XENDIT_CASH: money in the Xendit account.
 *  - WORKER_BALANCE (per worker): credit = earnings/credit the platform owes
 *    the worker; debit = dues the worker owes. One account covers both, so
 *    netting dues out of a payout needs no entry of its own.
 *  - CLIENT_RECEIVABLE (per client): cancellation fees owed.
 *  - COMMISSION_REVENUE, PENALTY_REVENUE: income.
 *  - WITHHOLDING_TAX_PAYABLE: owed to BIR.
 *  - XENDIT_FEES, PLATFORM_FUNDED_EXPENSE, REFUND_LOSS: expenses.
 *  - MANUAL_SETTLEMENTS: money that moved outside the app.
 *  - ADJUSTMENTS: admin corrections; OPENING_BALANCE: carried-in balances.
 */

type Client = Prisma.TransactionClient | typeof prisma;

export interface LedgerLineInput {
  account: LedgerAccount;
  amountCentavos: number; // debit +, credit −
  workerId?: string | null;
  clientId?: string | null;
}

export interface LedgerPosting {
  type: LedgerEventType;
  key: string;
  occurredAt?: Date;
  memo: string;
  bookingId?: string | null;
  paymentId?: string | null;
  payoutId?: string | null;
  lines: LedgerLineInput[];
}

/** Pesos (as stored on Payment/Payout) to whole centavos. */
export function toCentavos(pesos: number | null | undefined): number {
  return Math.round((pesos ?? 0) * 100);
}

let openCache = false;

/** Whether the ledger has been opened. Cached once true — it never closes. */
export async function isLedgerOpen(client: Client = prisma): Promise<boolean> {
  if (openCache) return true;
  const state = await client.ledgerState.findUnique({ where: { id: 'singleton' }, select: { openedAt: true } });
  openCache = Boolean(state?.openedAt);
  return openCache;
}

/** Test hook: forget the cached open state. */
export function resetLedgerOpenCache() {
  openCache = false;
}

/**
 * Posts one balanced transaction. Returns false (and posts nothing) when the
 * ledger isn't open yet or this key was already posted. Throws if the lines
 * don't balance — a bug to fix, never something to paper over.
 */
export async function postLedger(client: Client, posting: LedgerPosting): Promise<boolean> {
  const lines = posting.lines.filter((l) => l.amountCentavos !== 0);
  if (lines.some((l) => !Number.isInteger(l.amountCentavos))) {
    throw new Error(`Ledger posting ${posting.key} has a non-integer centavo amount`);
  }
  const sum = lines.reduce((total, l) => total + l.amountCentavos, 0);
  if (sum !== 0) {
    throw new Error(`Ledger posting ${posting.key} does not balance (off by ${sum} centavos)`);
  }
  if (lines.length === 0) return false;
  if (posting.type !== 'OPENING' && !(await isLedgerOpen(client))) return false;

  const existing = await client.ledgerTransaction.findUnique({ where: { idempotencyKey: posting.key }, select: { id: true } });
  if (existing) return false;

  try {
    await client.ledgerTransaction.create({
      data: {
        type: posting.type,
        idempotencyKey: posting.key,
        occurredAt: posting.occurredAt ?? new Date(),
        memo: posting.memo,
        bookingId: posting.bookingId ?? null,
        paymentId: posting.paymentId ?? null,
        payoutId: posting.payoutId ?? null,
        lines: {
          create: lines.map((l) => ({
            account: l.account,
            amountCentavos: l.amountCentavos,
            workerId: l.workerId ?? null,
            clientId: l.clientId ?? null,
          })),
        },
      },
    });
    return true;
  } catch (error) {
    // Two posts of the same event racing: the other one won, which is fine.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// One function per money event. Amounts come from the stored per-payment
// split; the worker's share is derived as the remainder so every entry
// balances to the centavo.
// ---------------------------------------------------------------------------

interface PaymentSplit {
  id: string;
  bookingId: string;
  totalAmount: number;
  capturedAmount?: number | null;
  commissionAmount: number;
  withholdingTaxAmount: number;
  workerPayout: number;
  capturedAt?: Date | null;
}

/**
 * How a captured online payment divides. The worker's share is of the
 * invoice; anything paid over it is owed back to the client (the payout only
 * ever sends workerPayout, so crediting it to the worker would leave a
 * balance that never clears).
 */
function splitCapture(payment: PaymentSplit) {
  const captured = toCentavos(payment.capturedAmount ?? payment.totalAmount);
  const invoiced = Math.min(captured, toCentavos(payment.totalAmount));
  const commission = toCentavos(payment.commissionAmount);
  const withholding = toCentavos(payment.withholdingTaxAmount);
  return { captured, overpaid: captured - invoiced, commission, withholding, workerShare: invoiced - commission - withholding };
}

/** Client paid online (GCash/Maya): the money lands at Xendit. */
export function postPaymentCaptured(client: Client, payment: PaymentSplit, workerId: string | null, clientId: string | null = null) {
  const { captured, overpaid, commission, withholding, workerShare } = splitCapture(payment);
  return postLedger(client, {
    type: 'PAYMENT_CAPTURED',
    key: `capture:${payment.id}`,
    occurredAt: payment.capturedAt ?? undefined,
    memo: 'Client payment received',
    bookingId: payment.bookingId,
    paymentId: payment.id,
    lines: [
      { account: 'XENDIT_CASH', amountCentavos: captured },
      { account: 'COMMISSION_REVENUE', amountCentavos: -commission },
      { account: 'WITHHOLDING_TAX_PAYABLE', amountCentavos: -withholding },
      // The rest (service price after commission/tax, tip, VAT) is the worker's.
      { account: 'WORKER_BALANCE', amountCentavos: -workerShare, workerId },
      ...(overpaid > 0 ? [{ account: 'CLIENT_RECEIVABLE' as const, amountCentavos: -overpaid, clientId }] : []),
    ],
  });
}

/** Cash job: the client paid the worker; the worker now owes commission + tax. */
export function postCashJobSettled(client: Client, payment: PaymentSplit, workerId: string) {
  const commission = toCentavos(payment.commissionAmount);
  const withholding = toCentavos(payment.withholdingTaxAmount);
  return postLedger(client, {
    type: 'CASH_JOB_SETTLED',
    key: `cash:${payment.id}`,
    occurredAt: payment.capturedAt ?? undefined,
    memo: 'Cash job: commission and tax owed by the worker',
    bookingId: payment.bookingId,
    paymentId: payment.id,
    lines: [
      { account: 'WORKER_BALANCE', amountCentavos: commission + withholding, workerId },
      { account: 'COMMISSION_REVENUE', amountCentavos: -commission },
      { account: 'WITHHOLDING_TAX_PAYABLE', amountCentavos: -withholding },
    ],
  });
}

/** Client never paid; the platform pays the worker's earnings itself. */
export function postPlatformFunded(client: Client, payment: PaymentSplit, workerId: string) {
  const worker = toCentavos(payment.workerPayout);
  const withholding = toCentavos(payment.withholdingTaxAmount);
  return postLedger(client, {
    type: 'PLATFORM_FUNDED',
    key: `platform-funded:${payment.id}`,
    memo: 'Worker paid from platform funds (client did not pay)',
    bookingId: payment.bookingId,
    paymentId: payment.id,
    lines: [
      { account: 'PLATFORM_FUNDED_EXPENSE', amountCentavos: worker + withholding },
      { account: 'WORKER_BALANCE', amountCentavos: -worker, workerId },
      { account: 'WITHHOLDING_TAX_PAYABLE', amountCentavos: -withholding },
    ],
  });
}

/** Money actually sent to a worker's GCash/Maya. */
export function postPayoutSent(
  client: Client,
  payout: { id: string; bookingId: string; workerId: string; amount: number; paidAt?: Date | null },
  memo = 'Payout sent to worker'
) {
  const amount = toCentavos(payout.amount);
  return postLedger(client, {
    type: 'PAYOUT_SENT',
    key: `payout:${payout.id}`,
    occurredAt: payout.paidAt ?? undefined,
    memo,
    bookingId: payout.bookingId,
    payoutId: payout.id,
    lines: [
      { account: 'WORKER_BALANCE', amountCentavos: amount, workerId: payout.workerId },
      { account: 'XENDIT_CASH', amountCentavos: -amount },
    ],
  });
}

/**
 * An online payment refunded through Xendit (the worker's payout was stopped
 * first, so their share simply comes back off their balance).
 */
export function postRefundSent(client: Client, payment: PaymentSplit, workerId: string | null, clientId: string | null = null) {
  const { captured, overpaid, commission, withholding, workerShare } = splitCapture(payment);
  return postLedger(client, {
    type: 'REFUND_SENT',
    key: `refund:${payment.id}`,
    memo: 'Refund sent to client',
    bookingId: payment.bookingId,
    paymentId: payment.id,
    lines: [
      { account: 'XENDIT_CASH', amountCentavos: -captured },
      { account: 'COMMISSION_REVENUE', amountCentavos: commission },
      { account: 'WITHHOLDING_TAX_PAYABLE', amountCentavos: withholding },
      { account: 'WORKER_BALANCE', amountCentavos: workerShare, workerId },
      // The overpayment went back with the refund, so the client is no longer owed it.
      ...(overpaid > 0 ? [{ account: 'CLIENT_RECEIVABLE' as const, amountCentavos: overpaid, clientId }] : []),
    ],
  });
}

/** A cash job refunded: the worker's commission + tax dues are reversed. */
export function postCashJobRefunded(client: Client, payment: PaymentSplit, workerId: string) {
  const commission = toCentavos(payment.commissionAmount);
  const withholding = toCentavos(payment.withholdingTaxAmount);
  return postLedger(client, {
    type: 'CASH_JOB_REFUNDED',
    key: `cash-refund:${payment.id}`,
    memo: 'Cash job refunded: dues reversed',
    bookingId: payment.bookingId,
    paymentId: payment.id,
    lines: [
      { account: 'WORKER_BALANCE', amountCentavos: -(commission + withholding), workerId },
      { account: 'COMMISSION_REVENUE', amountCentavos: commission },
      { account: 'WITHHOLDING_TAX_PAYABLE', amountCentavos: withholding },
    ],
  });
}

/**
 * An admin refunded an online payment outside the app. If the worker's
 * payout was still stopped in time, their share comes off their balance;
 * if it had already been sent, it's a loss unless the admin recovers it
 * (Adjust Dues posts that separately).
 */
export function postManualRefund(
  client: Client,
  payment: PaymentSplit,
  workerId: string | null,
  workerAlreadyPaid: boolean,
  clientId: string | null = null
) {
  const { captured, overpaid, commission, withholding, workerShare } = splitCapture(payment);
  return postLedger(client, {
    type: 'MANUAL_REFUND',
    key: `manual-refund:${payment.id}`,
    memo: workerAlreadyPaid ? 'Refunded outside the app after the worker was paid' : 'Refunded outside the app',
    bookingId: payment.bookingId,
    paymentId: payment.id,
    lines: [
      { account: 'MANUAL_SETTLEMENTS', amountCentavos: -captured },
      { account: 'COMMISSION_REVENUE', amountCentavos: commission },
      { account: 'WITHHOLDING_TAX_PAYABLE', amountCentavos: withholding },
      workerAlreadyPaid
        ? { account: 'REFUND_LOSS', amountCentavos: workerShare }
        : { account: 'WORKER_BALANCE', amountCentavos: workerShare, workerId },
      ...(overpaid > 0 ? [{ account: 'CLIENT_RECEIVABLE' as const, amountCentavos: overpaid, clientId }] : []),
    ],
  });
}

export function postPenalty(client: Client, workerId: string, amountPesos: number, ref: { key: string; bookingId?: string | null }) {
  const amount = toCentavos(amountPesos);
  return postLedger(client, {
    type: 'PENALTY',
    key: `penalty:${ref.key}`,
    memo: 'Worker penalty',
    bookingId: ref.bookingId,
    lines: [
      { account: 'WORKER_BALANCE', amountCentavos: amount, workerId },
      { account: 'PENALTY_REVENUE', amountCentavos: -amount },
    ],
  });
}

/** Client-fault cancellation: the client owes the fee, the worker is credited it. */
export function postCancellationFee(
  client: Client,
  clientId: string,
  workerId: string,
  amountPesos: number,
  ref: { key: string; bookingId?: string | null }
) {
  const amount = toCentavos(amountPesos);
  return postLedger(client, {
    type: 'CANCELLATION_FEE',
    key: `cancellation-fee:${ref.key}`,
    memo: 'Client-fault cancellation fee, credited to the worker',
    bookingId: ref.bookingId,
    lines: [
      { account: 'CLIENT_RECEIVABLE', amountCentavos: amount, clientId },
      { account: 'WORKER_BALANCE', amountCentavos: -amount, workerId },
    ],
  });
}

/** An admin cleared a client's fee hold (paid to support, or waived). */
export function postClientFeeCleared(client: Client, clientId: string, amountPesos: number, key: string) {
  const amount = toCentavos(amountPesos);
  return postLedger(client, {
    type: 'CLIENT_FEE_CLEARED',
    key: `client-fee-cleared:${key}`,
    memo: 'Client fee settled outside the app',
    lines: [
      { account: 'MANUAL_SETTLEMENTS', amountCentavos: amount },
      { account: 'CLIENT_RECEIVABLE', amountCentavos: -amount, clientId },
    ],
  });
}

/** Admin dues correction. Positive = the worker owes more. */
export function postAdminAdjustment(client: Client, workerId: string, owedDeltaPesos: number, key: string, note: string) {
  const amount = toCentavos(owedDeltaPesos);
  return postLedger(client, {
    type: 'ADMIN_ADJUSTMENT',
    key: `adjustment:${key}`,
    memo: `Admin dues adjustment: ${note}`,
    lines: [
      { account: 'WORKER_BALANCE', amountCentavos: amount, workerId },
      { account: 'ADJUSTMENTS', amountCentavos: -amount },
    ],
  });
}

/** A fee Xendit charged on one of its transactions (it hits the balance). */
export function postXenditFee(
  client: Client,
  fee: { xenditTransactionId: string; centavos: number; occurredAt: Date; memo: string; paymentId?: string | null; payoutId?: string | null }
) {
  return postLedger(client, {
    type: 'XENDIT_FEE',
    key: `xendit-fee:${fee.xenditTransactionId}`,
    occurredAt: fee.occurredAt,
    memo: fee.memo,
    paymentId: fee.paymentId,
    payoutId: fee.payoutId,
    lines: [
      { account: 'XENDIT_FEES', amountCentavos: fee.centavos },
      { account: 'XENDIT_CASH', amountCentavos: -fee.centavos },
    ],
  });
}
