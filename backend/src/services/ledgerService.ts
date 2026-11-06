import prisma from '@config/database';
import { Prisma, type LedgerAccount, type LedgerEventType } from '@prisma/client';

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

export function toCentavos(pesos: number | null | undefined): number {
  return Math.round((pesos ?? 0) * 100);
}

let openCache = false;

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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
}

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

function splitCapture(payment: PaymentSplit) {
  const captured = toCentavos(payment.capturedAmount ?? payment.totalAmount);
  const invoiced = Math.min(captured, toCentavos(payment.totalAmount));
  const commission = toCentavos(payment.commissionAmount);
  const withholding = toCentavos(payment.withholdingTaxAmount);
  return { captured, overpaid: captured - invoiced, commission, withholding, workerShare: invoiced - commission - withholding };
}

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
      { account: 'WORKER_BALANCE', amountCentavos: -workerShare, workerId },
      ...(overpaid > 0 ? [{ account: 'CLIENT_RECEIVABLE' as const, amountCentavos: -overpaid, clientId }] : []),
    ],
  });
}

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
      ...(overpaid > 0 ? [{ account: 'CLIENT_RECEIVABLE' as const, amountCentavos: overpaid, clientId }] : []),
    ],
  });
}

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

export function postDebtPayment(client: Client, workerId: string, amountPesos: number, debtPaymentId: string, occurredAt?: Date) {
  const amount = toCentavos(amountPesos);
  return postLedger(client, {
    type: 'DEBT_PAYMENT',
    key: `debt-payment:${debtPaymentId}`,
    occurredAt,
    memo: 'Worker paid platform dues online',
    lines: [
      { account: 'XENDIT_CASH', amountCentavos: amount },
      { account: 'WORKER_BALANCE', amountCentavos: -amount, workerId },
    ],
  });
}

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
