import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { createInvoice, retrieveInvoice } from '@services/xenditService';
import { applyDebtPaymentTx } from '@services/debtLedgerService';
import { notifyUser } from '@utils/notify';
import { roundToCentavo } from '@utils/money';

/** Thrown for a request the worker can fix (bad amount, nothing owed). */
export class DebtPaymentError extends Error {}

/** Xendit's smallest invoice. Unverified against Xendit's docs, so it's overridable. */
function xenditMinPesos(): number {
  const configured = Number(process.env.XENDIT_MIN_INVOICE_PESOS);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

/**
 * The smallest payment allowed: at least half of what's owed, and never below
 * Xendit's minimum invoice. A debt smaller than that minimum can only be paid
 * in full.
 */
export function minPaymentPesos(owed: number): number {
  return Math.min(owed, Math.max(roundToCentavo(owed / 2), xenditMinPesos()));
}

/** The amount to invoice: omitted means the full balance. */
export function resolveAmount(requested: number | undefined, owed: number): number {
  if (owed <= 0) throw new DebtPaymentError("You don't owe HomeEase anything right now.");
  if (requested === undefined) return owed;
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    throw new DebtPaymentError('Enter a valid amount.');
  }
  const amount = roundToCentavo(requested);
  const min = minPaymentPesos(owed);
  if (amount < min) throw new DebtPaymentError(`You need to pay at least ₱${min.toFixed(2)} (half of what you owe).`);
  if (amount > owed) throw new DebtPaymentError(`You only owe ₱${owed.toFixed(2)}.`);
  return amount;
}

type DebtCheckout = { checkoutUrl: string; debtPaymentId: string; amount: number } | { alreadyPaid: true };

/**
 * Starts (or resumes) a Xendit invoice for the worker's dues. One open invoice
 * per worker: if a PENDING one is still live its URL is returned instead of
 * minting a second — and if Xendit already shows it PAID (webhook missed), it
 * is settled right here.
 */
export async function createDebtPaymentInvoice(userId: string, requested?: number): Promise<DebtCheckout> {
  const profile = await prisma.workerProfile.findUnique({
    where: { userId },
    select: { id: true, commissionOwed: true, user: { select: { email: true } } },
  });
  if (!profile) throw new DebtPaymentError('Worker profile not found.');

  const existing = await prisma.debtPayment.findFirst({ where: { workerProfileId: profile.id, status: 'PENDING' } });
  if (existing?.xenditInvoiceId) {
    try {
      const inv = await retrieveInvoice(existing.xenditInvoiceId);
      const status = (inv?.status as string | undefined)?.toUpperCase();
      if (status === 'PAID' || status === 'SETTLED') {
        await finalizeDebtPayment(existing.id, inv.paid_amount ?? null, inv.paid_at ? new Date(inv.paid_at) : null);
        return { alreadyPaid: true };
      }
      if (status === 'PENDING' && inv?.invoice_url) {
        return { checkoutUrl: inv.invoice_url, debtPaymentId: existing.id, amount: existing.amount };
      }
      // Expired/failed on Xendit's side — retire it so a fresh one can be made.
      await prisma.debtPayment.updateMany({
        where: { id: existing.id, status: 'PENDING' },
        data: { status: status === 'EXPIRED' ? 'EXPIRED' : 'FAILED', failureReason: status ?? 'UNKNOWN' },
      });
    } catch (error) {
      // Can't confirm the old invoice: don't risk a second live one.
      if (existing.checkoutUrl) {
        return { checkoutUrl: existing.checkoutUrl, debtPaymentId: existing.id, amount: existing.amount };
      }
      throw error;
    }
  }

  const owed = roundToCentavo(Math.max(0, profile.commissionOwed));
  const amount = resolveAmount(requested, owed);

  let debtPayment;
  try {
    debtPayment = await prisma.debtPayment.create({ data: { workerProfileId: profile.id, amount } });
  } catch (error) {
    // A concurrent request opened an invoice first (one-PENDING-per-worker index).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const open = await prisma.debtPayment.findFirst({ where: { workerProfileId: profile.id, status: 'PENDING' } });
      if (open?.checkoutUrl) return { checkoutUrl: open.checkoutUrl, debtPaymentId: open.id, amount: open.amount };
      throw new DebtPaymentError('A payment is already being set up. Try again in a moment.');
    }
    throw error;
  }

  const redirectBase = process.env.XENDIT_REDIRECT_BASE_URL || 'https://homeease.app';
  try {
    const invoice = await createInvoice({
      externalId: debtPayment.id,
      amountPesos: amount,
      description: 'HomeEase platform dues',
      payerEmail: profile.user.email ?? undefined,
      successRedirectUrl: `${redirectBase}/payment-redirect/success?duesPaymentId=${debtPayment.id}`,
      failureRedirectUrl: `${redirectBase}/payment-redirect/failed?duesPaymentId=${debtPayment.id}`,
    });
    await prisma.debtPayment.update({
      where: { id: debtPayment.id },
      data: { xenditInvoiceId: invoice.id, checkoutUrl: invoice.invoiceUrl },
    });
    return { checkoutUrl: invoice.invoiceUrl, debtPaymentId: debtPayment.id, amount };
  } catch (error) {
    // Never leave a PENDING row without an invoice — it would block retries.
    await prisma.debtPayment.update({
      where: { id: debtPayment.id },
      data: { status: 'FAILED', failureReason: 'Invoice could not be created' },
    });
    throw error;
  }
}

/**
 * Settles a paid DebtPayment: claims it (so a replayed webhook is a no-op),
 * lowers commissionOwed, and books the cash — all in one transaction.
 * Returns false if it was already settled.
 */
export async function finalizeDebtPayment(
  debtPaymentId: string,
  paidAmount: number | null,
  paidAt: Date | null
): Promise<boolean> {
  const outcome = await prisma.$transaction(async (tx) => {
    const row = await tx.debtPayment.findUnique({ where: { id: debtPaymentId } });
    if (!row) return null;
    const paid = roundToCentavo(paidAmount ?? row.amount);
    const claimed = await tx.debtPayment.updateMany({
      where: { id: debtPaymentId, status: 'PENDING' },
      data: { status: 'PAID', paidAmount: paid, paidAt: paidAt ?? new Date() },
    });
    if (claimed.count === 0) return null;
    const result = await applyDebtPaymentTx(tx, row.workerProfileId, paid, debtPaymentId, paidAt ?? undefined);
    return { paid, userId: result.workerProfile.userId, owedAfter: result.workerProfile.commissionOwed, holdReleased: result.holdReleased };
  });
  if (!outcome) return false;

  await notifyUser({
    userId: outcome.userId,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment received',
    message:
      `We received your ₱${outcome.paid.toFixed(2)} payment. ` +
      (outcome.owedAfter > 0 ? `You still owe ₱${outcome.owedAfter.toFixed(2)}.` : "You're all settled with HomeEase.") +
      (outcome.holdReleased ? ' Your account is back in good standing.' : ''),
  });
  return true;
}

/** Marks an expired/failed invoice so the worker can start a new one. */
export async function failDebtPayment(xenditInvoiceId: string, reason: string): Promise<void> {
  await prisma.debtPayment.updateMany({
    where: { xenditInvoiceId, status: 'PENDING' },
    data: { status: reason === 'EXPIRED' ? 'EXPIRED' : 'FAILED', failureReason: reason },
  });
}
