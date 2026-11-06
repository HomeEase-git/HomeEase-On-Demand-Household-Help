import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { createInvoice, retrieveInvoice, findInvoiceByExternalId } from '@services/xenditService';
import { applyDebtPaymentTx } from '@services/debtLedgerService';
import { notifyUser } from '@utils/notify';
import { roundToCentavo } from '@utils/money';

export class DebtPaymentError extends Error {}

function xenditMinPesos(): number {
  const configured = Number(process.env.XENDIT_MIN_INVOICE_PESOS);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

export function minPaymentPesos(owed: number): number {
  return Math.min(owed, Math.max(roundToCentavo(owed / 2), xenditMinPesos()));
}

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

const UNFINISHED_AFTER_MS = 5 * 60 * 1000;

type DebtPaymentRow = NonNullable<Awaited<ReturnType<typeof prisma.debtPayment.findFirst>>>;

async function recoverUnfinishedDebtPayment(row: DebtPaymentRow): Promise<DebtPaymentRow | null> {
  if (Date.now() - row.createdAt.getTime() < UNFINISHED_AFTER_MS) {
    throw new DebtPaymentError('A payment is already being set up. Try again in a moment.');
  }

  const invoice = await findInvoiceByExternalId(row.id);
  if (invoice) {
    const { count } = await prisma.debtPayment.updateMany({
      where: { id: row.id, status: 'PENDING', xenditInvoiceId: null },
      data: { xenditInvoiceId: invoice.id, checkoutUrl: invoice.invoice_url ?? null },
    });
    if (count === 1) return prisma.debtPayment.findUnique({ where: { id: row.id } });
    const current = await prisma.debtPayment.findUnique({ where: { id: row.id } });
    return current?.status === 'PENDING' ? current : null;
  }

  await prisma.debtPayment.updateMany({
    where: { id: row.id, status: 'PENDING', xenditInvoiceId: null },
    data: { status: 'FAILED', failureReason: 'Invoice creation was interrupted' },
  });
  return null;
}

type DebtCheckout = { checkoutUrl: string; debtPaymentId: string; amount: number } | { alreadyPaid: true };

export async function createDebtPaymentInvoice(userId: string, requested?: number): Promise<DebtCheckout> {
  const profile = await prisma.workerProfile.findUnique({
    where: { userId },
    select: { id: true, commissionOwed: true, user: { select: { email: true } } },
  });
  if (!profile) throw new DebtPaymentError('Worker profile not found.');

  let existing = await prisma.debtPayment.findFirst({ where: { workerProfileId: profile.id, status: 'PENDING' } });
  if (existing && !existing.xenditInvoiceId) existing = await recoverUnfinishedDebtPayment(existing);
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
      await prisma.debtPayment.updateMany({
        where: { id: existing.id, status: 'PENDING' },
        data: { status: status === 'EXPIRED' ? 'EXPIRED' : 'FAILED', failureReason: status ?? 'UNKNOWN' },
      });
    } catch (error) {
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
    await prisma.debtPayment.update({
      where: { id: debtPayment.id },
      data: { status: 'FAILED', failureReason: 'Invoice could not be created' },
    });
    throw error;
  }
}

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

export async function reconcilePendingDebtPayment(debtPaymentId: string): Promise<'paid' | 'failed' | 'pending'> {
  let row = await prisma.debtPayment.findUnique({ where: { id: debtPaymentId } });
  if (!row || row.status !== 'PENDING') return 'pending';

  if (!row.xenditInvoiceId) {
    if (Date.now() - row.createdAt.getTime() < UNFINISHED_AFTER_MS) return 'pending';
    row = await recoverUnfinishedDebtPayment(row);
    if (!row) return 'failed';
  }
  if (!row.xenditInvoiceId) return 'pending';

  const inv = await retrieveInvoice(row.xenditInvoiceId);
  const status = (inv?.status as string | undefined)?.toUpperCase();

  if (status === 'PAID' || status === 'SETTLED') {
    const finalized = await finalizeDebtPayment(row.id, inv.paid_amount ?? null, inv.paid_at ? new Date(inv.paid_at) : null);
    return finalized ? 'paid' : 'pending';
  }
  if (status === 'EXPIRED' || status === 'FAILED') {
    await failDebtPayment(row.xenditInvoiceId, status);
    return 'failed';
  }
  return 'pending';
}

export async function reconcileStalePendingDebtPayments(
  cutoff: Date
): Promise<{ debtPaymentId: string; result: 'paid' | 'failed' }[]> {
  const stale = await prisma.debtPayment.findMany({
    where: { status: 'PENDING', createdAt: { lte: cutoff } },
    select: { id: true },
  });
  const changed: { debtPaymentId: string; result: 'paid' | 'failed' }[] = [];
  for (const { id } of stale) {
    try {
      const result = await reconcilePendingDebtPayment(id);
      if (result !== 'pending') changed.push({ debtPaymentId: id, result });
    } catch (error) {
      console.error(`Failed to reconcile pending dues payment ${id}:`, error);
    }
  }
  return changed;
}

export async function failDebtPayment(xenditInvoiceId: string, reason: string): Promise<void> {
  await prisma.debtPayment.updateMany({
    where: { xenditInvoiceId, status: 'PENDING' },
    data: { status: reason === 'EXPIRED' ? 'EXPIRED' : 'FAILED', failureReason: reason },
  });
}
