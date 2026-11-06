import prisma from '@config/database';
import {
  calculateCommission,
  calculateWithholdingTax,
  computeBookingFinalTotal,
} from '@utils/pricing';
import { createInvoice, expireInvoice, retrieveInvoice, createRefund, retrieveRefund, type XenditRefund } from '@services/xenditService';
import { cancelPayout, retrievePayout } from '@services/xenditDisbursementService';
import { applyXenditPayoutStatus } from '@services/payoutStatusService';
import {
  postPaymentCaptured,
  postCashJobSettled,
  postPlatformFunded,
  postRefundSent,
  postCashJobRefunded,
} from '@services/ledgerService';
import { notifyUser } from '@utils/notify';
import { getAppSettings } from '@services/appSettingsService';
import { schedulePayout } from '@queues/payoutQueue';
import { writeAuditLog } from '@utils/auditLog';
import { recoverDebtTx, accrueDebtTx, reverseDebtTx, lockDuesTx, restoreSettlementTx } from '@services/debtLedgerService';
import { roundToCentavo } from '@utils/money';
import { updateBookingIfStatus, isBookingStatusConflict } from '@services/bookingStatusWrite';

const COMPLETABLE_STATUSES = ['PENDING_COMPLETION', 'AWAITING_PAYMENT', 'DISPUTED'] as const;

interface BookingWithAddOns {
  id: string;
  workerId: string | null;
  clientId: string;
  status: string;
  estimatedPrice: number;
  laborCost: number | null;
  materialsCost: number | null;
  tip: number | null;
  paymentMethodType: 'GCASH' | 'MAYA' | 'CASH' | null;
  paymentAccountIdentifier: string | null;
  awaitingPaymentSince: Date | null;
  vatApplicable: boolean;
  vatRate: number | null;
  commissionRateSnapshot: number | null;
  withholdingTaxRateSnapshot: number | null;
  addOns?: Array<{ price: number }>;
}

async function loadBooking(bookingId: string): Promise<BookingWithAddOns> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { addOns: { where: { clientApprovedAt: { not: null } } } },
  });
  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  return booking as unknown as BookingWithAddOns;
}

function resolveRates(
  booking: Pick<BookingWithAddOns, 'commissionRateSnapshot' | 'withholdingTaxRateSnapshot'>,
  liveSettings: { commissionRate: number; withholdingTaxRate: number }
) {
  return {
    commissionRate: booking.commissionRateSnapshot ?? liveSettings.commissionRate,
    withholdingTaxRate: booking.withholdingTaxRateSnapshot ?? liveSettings.withholdingTaxRate,
  };
}

function priceBooking(booking: BookingWithAddOns, commissionRate: number, withholdingTaxRate: number) {
  const { subtotal, tip, vatAmount, totalAmount } = computeBookingFinalTotal({
    estimatedPrice: booking.estimatedPrice,
    laborCost: booking.laborCost,
    materialsCost: booking.materialsCost,
    tip: booking.tip,
    addOns: booking.addOns,
    vatApplicable: booking.vatApplicable,
    vatRate: booking.vatRate,
  });
  const commissionAmount = calculateCommission(subtotal, commissionRate);
  const withholdingTaxAmount = calculateWithholdingTax(subtotal, commissionRate, withholdingTaxRate);
  const workerPayout = roundToCentavo(subtotal - commissionAmount - withholdingTaxAmount + tip + vatAmount);
  return {
    subtotal,
    tip,
    vatApplicable: booking.vatApplicable,
    vatRate: booking.vatRate,
    vatAmount,
    totalAmount,
    commissionAmount,
    withholdingTaxAmount,
    workerPayout,
  };
}

function cashJobDuesMessage(collected: number, platformCut: number, coveredByCredit: number): string {
  const owed = roundToCentavo(platformCut - coveredByCredit);
  const intro = `You collected ₱${collected.toFixed(2)} in cash. The ₱${platformCut.toFixed(2)} service fee`;
  if (owed <= 0) return `${intro} was covered by your payout credit — nothing to pay.`;
  if (coveredByCredit > 0) {
    return (
      `${intro} was partly covered by your ₱${coveredByCredit.toFixed(2)} payout credit. ` +
      `The remaining ₱${owed.toFixed(2)} will be deducted from your next online-job payout.`
    );
  }
  return `${intro} will be deducted from your next online-job payout.`;
}

export async function settleCashBooking(
  bookingId: string,
  fromStatuses: readonly (typeof COMPLETABLE_STATUSES)[number][] = COMPLETABLE_STATUSES
) {
  const booking = await loadBooking(bookingId);
  const { commissionRate, withholdingTaxRate } = resolveRates(booking, await getAppSettings());
  const priced = priceBooking(booking, commissionRate, withholdingTaxRate);
  const platformCut = roundToCentavo(priced.commissionAmount + priced.withholdingTaxAmount);

  const { payment, coveredByCredit } = await prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { bookingId } });
    if (existing && existing.status === 'COMPLETED') {
      return { payment: existing, coveredByCredit: 0 };
    }

    const paymentData = {
      subtotal: priced.subtotal,
      tip: priced.tip,
      commissionRate,
      commissionAmount: priced.commissionAmount,
      withholdingTaxRate,
      withholdingTaxAmount: priced.withholdingTaxAmount,
      vatApplicable: priced.vatApplicable,
      vatRate: priced.vatRate,
      vatAmount: priced.vatAmount,
      workerPayout: priced.workerPayout,
      totalAmount: priced.totalAmount,
      status: 'COMPLETED' as const,
      escrowStatus: 'RELEASED' as const,
      capturedAmount: priced.totalAmount,
      capturedAt: new Date(),
      releasedAt: new Date(),
      workerSettledAt: new Date(),
      methodType: 'CASH' as const,
      accountIdentifier: booking.paymentAccountIdentifier ?? null,
    };

    const payment = existing
      ? await tx.payment.update({ where: { id: existing.id }, data: paymentData })
      : await tx.payment.create({ data: { bookingId, ...paymentData } });

    await updateBookingIfStatus(tx, bookingId, fromStatuses, {
      status: 'COMPLETED',
      finalPrice: priced.subtotal,
      vatAmount: priced.vatAmount,
      completionDate: new Date(),
    });

    if (booking.workerId && platformCut > 0) {
      const workerProfile = await tx.workerProfile.findUnique({
        where: { userId: booking.workerId },
        select: { id: true },
      });
      if (workerProfile) {
        const accrued = await accrueDebtTx(tx, workerProfile.id, platformCut, {
          bookingId,
          note: 'Commission + withholding tax on a cash job (paid to you in person)',
        });
        await postCashJobSettled(tx, payment, booking.workerId);
        return { payment, coveredByCredit: accrued.coveredByCredit };
      }
    }

    return { payment, coveredByCredit: 0 };
  });

  if (booking.workerId) {
    await notifyUser({
      userId: booking.workerId,
      type: 'PAYMENT_RECEIVED',
      title: 'Cash Job Completed',
      message: cashJobDuesMessage(priced.totalAmount, platformCut, coveredByCredit),
      relatedId: bookingId,
    });
  }

  return payment;
}

export async function createCompletionInvoice(bookingId: string): Promise<
  | { checkoutUrl: string; invoiceId: string; paymentId: string; amount: number }
  | { alreadyPaid: true }
> {
  const booking = await loadBooking(bookingId);
  const method = booking.paymentMethodType;
  if (method !== 'GCASH' && method !== 'MAYA') {
    throw new Error(`createCompletionInvoice called for non-gateway method ${method}`);
  }

  const client = await prisma.user.findUnique({
    where: { id: booking.clientId },
    select: { email: true },
  });
  const { commissionRate, withholdingTaxRate } = resolveRates(booking, await getAppSettings());
  const priced = priceBooking(booking, commissionRate, withholdingTaxRate);

  const existing = await prisma.payment.findUnique({ where: { bookingId } });
  if (existing && existing.status === 'COMPLETED') {
    throw new Error(`Booking ${bookingId} is already paid`);
  }

  let underpaid = false;
  if (existing && existing.status === 'PENDING' && existing.xenditInvoiceId) {
    try {
      const inv = await retrieveInvoice(existing.xenditInvoiceId);
      const invStatus = (inv?.status as string)?.toUpperCase();
      if (invStatus === 'PAID' || invStatus === 'SETTLED') {
        const finalized = await finalizePaidBooking(
          existing.id,
          inv.payment_id ?? null,
          inv.paid_amount ?? null,
          inv.paid_at ? new Date(inv.paid_at) : null
        );
        if (!finalized) underpaid = true;
        else return { alreadyPaid: true };
      }
      if (invStatus === 'PENDING' && inv?.invoice_url) {
        return {
          checkoutUrl: inv.invoice_url,
          invoiceId: existing.xenditInvoiceId,
          paymentId: existing.id,
          amount: existing.totalAmount,
        };
      }
    } catch {
      // fall through and mint a fresh invoice
    }
  }
  if (existing && existing.status === 'FAILED' && existing.xenditInvoiceId) {
    const old = await retrieveInvoice(existing.xenditInvoiceId);
    const oldStatus = (old?.status as string | undefined)?.toUpperCase();
    if (oldStatus === 'PAID' || oldStatus === 'SETTLED') {
      await writeAuditLog({
        action: 'PAYMENT_AFTER_VOID',
        category: 'SYSTEM_ERROR',
        level: 'ERROR',
        message: `Voided invoice ${existing.xenditInvoiceId} for booking ${bookingId} was paid — not re-issued, settle it manually.`,
        metadata: { paymentId: existing.id, bookingId, invoiceId: existing.xenditInvoiceId, paidAmount: old.paid_amount ?? null },
      });
      throw new Error(`Booking ${bookingId} has a paid voided invoice that needs a manual review`);
    }
  }

  if (underpaid) {
    throw new Error(`Booking ${bookingId} has a partly paid invoice that needs a manual review`);
  }

  const redirectBase = process.env.XENDIT_REDIRECT_BASE_URL || 'https://homeease.app';

  const payment = existing
    ? await prisma.payment.update({
        where: { id: existing.id },
        data: {
          status: 'PENDING',
          escrowStatus: 'HELD',
          subtotal: priced.subtotal,
          tip: priced.tip,
          commissionRate,
          commissionAmount: priced.commissionAmount,
          withholdingTaxRate,
          withholdingTaxAmount: priced.withholdingTaxAmount,
          vatApplicable: priced.vatApplicable,
          vatRate: priced.vatRate,
          vatAmount: priced.vatAmount,
          workerPayout: priced.workerPayout,
          totalAmount: priced.totalAmount,
          methodType: method,
          accountIdentifier: booking.paymentAccountIdentifier ?? null,
          failureReason: null,
          xenditInvoiceId: null,
          xenditPaymentId: null,
        },
      })
    : await prisma.payment.create({
        data: {
          bookingId,
          subtotal: priced.subtotal,
          tip: priced.tip,
          commissionRate,
          commissionAmount: priced.commissionAmount,
          withholdingTaxRate,
          withholdingTaxAmount: priced.withholdingTaxAmount,
          vatApplicable: priced.vatApplicable,
          vatRate: priced.vatRate,
          vatAmount: priced.vatAmount,
          workerPayout: priced.workerPayout,
          totalAmount: priced.totalAmount,
          status: 'PENDING',
          escrowStatus: 'HELD',
          methodType: method,
          accountIdentifier: booking.paymentAccountIdentifier ?? null,
        },
      });

  const invoice = await createInvoice({
    externalId: payment.id,
    amountPesos: priced.totalAmount,
    description: `HomeEase booking ${bookingId}`,
    payerEmail: client?.email ?? undefined,
    successRedirectUrl: `${redirectBase}/payment-redirect/success?bookingId=${bookingId}`,
    failureRedirectUrl: `${redirectBase}/payment-redirect/failed?bookingId=${bookingId}`,
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: { xenditInvoiceId: invoice.id },
  });

  await updateBookingIfStatus(prisma, bookingId, ['PENDING_COMPLETION', 'AWAITING_PAYMENT'], {
    status: 'AWAITING_PAYMENT',
    finalPrice: priced.subtotal,
    awaitingPaymentSince: booking.awaitingPaymentSince ?? new Date(),
  });

  return { checkoutUrl: invoice.invoiceUrl, invoiceId: invoice.id, paymentId: payment.id, amount: priced.totalAmount };
}

class PayoutHeldNoMethodError extends Error {
  constructor(
    readonly bookingId: string,
    readonly workerUserId: string,
    readonly payoutAmount: number,
    readonly totalAmount: number
  ) {
    super('Worker has no payout method');
  }
}

async function flagPayoutHeldNoMethod(held: PayoutHeldNoMethodError): Promise<void> {
  const alreadyFlagged = await prisma.auditLog.findFirst({
    where: { action: 'PAYOUT_BLOCKED_NO_METHOD', metadata: { path: ['bookingId'], equals: held.bookingId } },
    select: { id: true },
  });
  if (alreadyFlagged) return;

  await writeAuditLog({
    action: 'PAYOUT_BLOCKED_NO_METHOD',
    category: 'SYSTEM_ERROR',
    message: `Worker ${held.workerUserId} has no payout method — payout for booking ${held.bookingId} is held until one is added`,
    metadata: { bookingId: held.bookingId, workerId: held.workerUserId },
  });
  await notifyUser({
    userId: held.workerUserId,
    type: 'PAYMENT_RECEIVED',
    title: 'Add a payout account to get paid',
    message: `The client paid ₱${held.totalAmount.toFixed(2)}. Add a GCash or Maya payout account to receive your ₱${held.payoutAmount.toFixed(2)} — it's being held for you until then.`,
    relatedId: held.bookingId,
  });
}

export async function settleWorkerEarnings(paymentId: string): Promise<void> {
  const outcome = await prisma.$transaction(async (tx) => {
    const claim = await tx.payment.updateMany({
      where: { id: paymentId, status: 'COMPLETED', workerSettledAt: null },
      data: { workerSettledAt: new Date() },
    });
    if (claim.count === 0) return null;

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { booking: { select: { workerId: true } } },
    });
    const workerUserId = payment.booking.workerId;
    if (!workerUserId) return { payoutId: null, payoutAmount: 0, totalAmount: payment.totalAmount, workerUserId };

    const workerProfile = await tx.workerProfile.findUnique({
      where: { userId: workerUserId },
      select: {
        id: true,
        payoutMethod: true,
        payoutAccountName: true,
        payoutAccountNumber: true,
      },
    });

    let payoutAmount = payment.workerPayout;
    if (workerProfile) {
      const recovered = await recoverDebtTx(tx, workerProfile.id, payoutAmount, {
        bookingId: payment.bookingId,
        note: 'Withheld from payout to clear outstanding platform dues',
      });
      payoutAmount = roundToCentavo(payoutAmount - recovered);

      const { compensationCredit } = await lockDuesTx(tx, workerProfile.id);
      if (compensationCredit > 0) {
        payoutAmount = roundToCentavo(payoutAmount + compensationCredit);
        await tx.workerProfile.update({
          where: { id: workerProfile.id },
          data: { compensationCredit: 0 },
        });
        await tx.payment.update({ where: { id: payment.id }, data: { compensationPaid: compensationCredit } });
      }
    }

    let payoutId: string | null = null;
    if (payoutAmount > 0) {
      if (!workerProfile?.payoutMethod || !workerProfile.payoutAccountNumber) {
        throw new PayoutHeldNoMethodError(payment.bookingId, workerUserId, payoutAmount, payment.totalAmount);
      }
      const payout = await tx.payout.create({
        data: {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          workerId: workerUserId,
          amount: payoutAmount,
          channel: workerProfile.payoutMethod,
          accountName: workerProfile.payoutAccountName,
          accountNumber: workerProfile.payoutAccountNumber,
        },
      });
      payoutId = payout.id;
    }

    return { payoutId, payoutAmount, totalAmount: payment.totalAmount, workerUserId, bookingId: payment.bookingId };
  }).catch(async (error) => {
    if (!(error instanceof PayoutHeldNoMethodError)) throw error;
    await flagPayoutHeldNoMethod(error);
    return null;
  });

  if (!outcome) return; // settlement already claimed by another run, or held

  if (outcome.payoutId) {
    await schedulePayout(outcome.payoutId).catch((error) => {
      console.error(`Failed to enqueue payout ${outcome.payoutId}:`, error);
    });
  }

  if (outcome.workerUserId) {
    await notifyUser({
      userId: outcome.workerUserId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment Received',
      message:
        outcome.payoutAmount > 0
          ? `The client paid ₱${outcome.totalAmount.toFixed(2)}. ₱${outcome.payoutAmount.toFixed(2)} is on its way to your account.`
          : `The client paid ₱${outcome.totalAmount.toFixed(2)}. Your earnings were applied to your outstanding platform dues.`,
      relatedId: outcome.bookingId,
    });
  }
}

export async function finalizePaidBooking(
  paymentId: string,
  xenditPaymentRef?: string | null,
  paidAmount?: number | null,
  paidAt?: Date | null
) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: true },
  });
  if (!payment) throw new Error(`Payment ${paymentId} not found`);

  if (payment.status === 'COMPLETED') {
    await settleWorkerEarnings(payment.id);
    return payment;
  }

  if (paidAmount == null || roundToCentavo(paidAmount) < roundToCentavo(payment.totalAmount)) {
    await writeAuditLog({
      action: 'PAYMENT_UNDERPAID',
      category: 'SYSTEM_ERROR',
      level: 'ERROR',
      message:
        `Xendit reports ${paidAmount == null ? 'no paid amount' : `₱${paidAmount.toFixed(2)} paid`} for booking ${payment.bookingId}, ` +
        `but the invoice total is ₱${payment.totalAmount.toFixed(2)} — not marked paid, review it manually.`,
      metadata: { paymentId: payment.id, bookingId: payment.bookingId, paidAmount, totalAmount: payment.totalAmount },
    });
    return null;
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: 'COMPLETED' } },
        data: {
          status: 'COMPLETED',
          escrowStatus: 'RELEASED',
          xenditPaymentId: xenditPaymentRef ?? payment.xenditPaymentId ?? null,
          capturedAmount: paidAmount ?? payment.totalAmount,
          capturedAt: paidAt ?? new Date(),
          releasedAt: new Date(),
        },
      });
      if (claim.count === 0) return null;
      const p = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });

      await updateBookingIfStatus(tx, payment.bookingId, COMPLETABLE_STATUSES, {
        status: 'COMPLETED',
        finalPrice: payment.subtotal,
        vatAmount: payment.vatAmount,
        completionDate: new Date(),
      });

      await postPaymentCaptured(tx, p, payment.booking.workerId, payment.booking.clientId);

      await tx.dispute.updateMany({
        where: {
          bookingId: payment.bookingId,
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
          reason: { startsWith: 'Payment overdue' },
        },
        data: { status: 'RESOLVED', resolution: 'Client completed payment', resolvedAt: new Date() },
      });

      return p;
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) {
      await writeAuditLog({
        action: 'PAYMENT_FOR_INACTIVE_BOOKING',
        category: 'SYSTEM_ERROR',
        level: 'ERROR',
        message: `Xendit reports payment ${payment.id} paid, but booking ${payment.bookingId} is no longer awaiting payment — review it manually.`,
        metadata: { paymentId: payment.id, bookingId: payment.bookingId },
      });
    }
    throw error;
  }

  if (updated === null) {
    await settleWorkerEarnings(payment.id);
    return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  await settleWorkerEarnings(payment.id);

  await notifyUser({
    userId: payment.booking.clientId,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment Confirmed',
    message: 'Your payment was received. Thank you for using HomeEase!',
    relatedId: payment.bookingId,
  });

  return updated;
}

export async function settlePlatformFundedPayment(bookingId: string) {
  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  if (!payment) {
    throw new Error(
      `No Payment exists yet for booking ${bookingId} — resolve the dispute via RESOLVE_FOR_WORKER first so one gets created.`
    );
  }

  if (payment.status === 'COMPLETED') {
    await settleWorkerEarnings(payment.id);
    return payment;
  }

  const updated = await prisma.$transaction(async (tx) => {
    await updateBookingIfStatus(tx, bookingId, ['AWAITING_PAYMENT', 'DISPUTED'], {
      status: 'COMPLETED',
      finalPrice: payment.subtotal,
      vatAmount: payment.vatAmount,
      completionDate: new Date(),
    });

    const p = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        platformFunded: true,
        failureReason: null,
        capturedAmount: payment.totalAmount,
        capturedAt: new Date(),
        releasedAt: new Date(),
      },
    });

    const booked = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { workerId: true } });
    if (booked.workerId) await postPlatformFunded(tx, p, booked.workerId);

    return p;
  });

  await settleWorkerEarnings(payment.id);

  return updated;
}

export async function voidUnpaidPayment(bookingId: string, reason: string) {
  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  if (!payment || payment.status !== 'PENDING') return payment ?? null;

  if (payment.xenditInvoiceId) {
    try {
      await expireInvoice(payment.xenditInvoiceId);
    } catch (error) {
      const remote = await retrieveInvoice(payment.xenditInvoiceId).catch(() => null);
      const remoteStatus = (remote?.status as string | undefined)?.toUpperCase();
      if (remoteStatus === 'PAID' || remoteStatus === 'SETTLED') return payment;
      console.error('Could not expire Xendit invoice %s for booking %s:', payment.xenditInvoiceId, bookingId, error);
    }
  }

  return prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED', failureReason: reason, escrowStatus: 'REFUNDED', refundReason: reason, refundedAt: new Date() },
  });
}

export class PayoutAlreadySentError extends Error {
  constructor(bookingId: string) {
    super(`Payout for booking ${bookingId} has already been disbursed — this refund needs a manual clawback.`);
  }
}

export class PayoutInFlightError extends Error {
  constructor(bookingId: string) {
    super(`Payout for booking ${bookingId} is being sent right now — retry the refund in a minute.`);
  }
}

function manualClawbackError(bookingId: string) {
  return new PayoutAlreadySentError(bookingId);
}

export async function stopWorkerPayout(paymentId: string, bookingId: string, reason: string): Promise<void> {
  const claim = await prisma.payment.updateMany({
    where: { id: paymentId, workerSettledAt: null },
    data: { workerSettledAt: new Date() },
  });
  if (claim.count === 1) return;

  const cancelIfNotSent = () =>
    prisma.payout.updateMany({
      where: { paymentId, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'CANCELLED', failureReason: `Booking refunded: ${reason}`, failedAt: new Date() },
    });

  const payout = await prisma.payout.findUnique({ where: { paymentId } });
  if (!payout || payout.status === 'CANCELLED') return;
  if (payout.status === 'PAID') throw manualClawbackError(bookingId);
  if ((await cancelIfNotSent()).count === 1) return;

  const inFlight = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
  if (inFlight.status === 'CANCELLED') return;
  if (inFlight.status !== 'PROCESSING') throw manualClawbackError(bookingId);
  const xenditPayoutId = inFlight.xenditDisbursementId;
  if (!xenditPayoutId) {
    throw new PayoutInFlightError(bookingId);
  }

  const remoteStatus = await cancelPayout(xenditPayoutId)
    .then((r) => r.status)
    .catch(() =>
      retrievePayout(xenditPayoutId)
        .then((r) => r.status)
        .catch(() => undefined)
    );
  await applyXenditPayoutStatus(inFlight, remoteStatus, { failureReason: `Booking refunded: ${reason}` });
  await cancelIfNotSent();

  const final = await prisma.payout.findUniqueOrThrow({ where: { paymentId }, select: { status: true } });
  if (final.status !== 'CANCELLED') throw manualClawbackError(bookingId);
}

async function requestXenditRefund(payment: {
  id: string;
  xenditInvoiceId: string;
  xenditRefundId: string | null;
  amountPesos: number;
}): Promise<XenditRefund> {
  const prior = payment.xenditRefundId ? await retrieveRefund(payment.xenditRefundId) : null;
  const refund =
    prior && (prior.status === 'PENDING' || prior.status === 'SUCCEEDED')
      ? prior
      : await createRefund({
          xenditInvoiceId: payment.xenditInvoiceId,
          amountPesos: payment.amountPesos,
          reason: 'REQUESTED_BY_CUSTOMER',
          idempotencyKey: prior ? `refund-${payment.id}-after-${prior.id}` : `refund-${payment.id}`,
        });

  await prisma.payment.update({
    where: { id: payment.id },
    data: { xenditRefundId: refund.id, xenditRefundStatus: refund.status },
  });

  if (refund.status !== 'SUCCEEDED' && refund.status !== 'PENDING') {
    throw new Error(`Xendit refund for invoice ${payment.xenditInvoiceId} did not succeed (status: ${refund.status})`);
  }
  return refund;
}

export async function reconcilePendingRefund(paymentId: string): Promise<'succeeded' | 'failed' | 'pending'> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.xenditRefundId || payment.xenditRefundStatus !== 'PENDING') return 'pending';

  const refund = await retrieveRefund(payment.xenditRefundId);
  if (refund.status === 'SUCCEEDED') {
    await prisma.payment.update({ where: { id: payment.id }, data: { xenditRefundStatus: 'SUCCEEDED' } });
    await undoWorkerSettlement(payment.id);
    const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId }, select: { workerId: true, clientId: true } });
    await postRefundSent(prisma, payment, booking?.workerId ?? null, booking?.clientId ?? null);
    return 'succeeded';
  }
  if (refund.status !== 'FAILED' && refund.status !== 'CANCELLED') return 'pending';

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'COMPLETED', escrowStatus: 'RELEASED', xenditRefundStatus: refund.status, refundedAt: null },
  });
  const failureReason = `Xendit refund ended ${refund.status}${refund.failure_code ? ` (${refund.failure_code})` : ''}`;
  const approved = await prisma.refundRequest.findMany({
    where: { paymentId: payment.id, status: 'APPROVED' },
    select: { id: true, disputeId: true },
  });
  for (const request of approved) {
    await prisma.refundRequest.update({ where: { id: request.id }, data: { status: 'FAILED', failureReason } });
    if (request.disputeId) {
      await prisma.dispute.update({
        where: { id: request.disputeId },
        data: { refundStatus: 'FAILED', refundFailureReason: failureReason },
      });
    }
  }
  await writeAuditLog({
    action: 'REFUND_FAILED',
    category: 'SYSTEM_ERROR',
    level: 'ERROR',
    message:
      `Xendit refund ${refund.id} for booking ${payment.bookingId} ended ${refund.status}` +
      `${refund.failure_code ? ` (${refund.failure_code})` : ''} — the client has not been refunded; retry it.`,
    metadata: { paymentId: payment.id, bookingId: payment.bookingId, refundId: refund.id },
  });
  return 'failed';
}

export async function undoWorkerSettlement(paymentId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const claim = await tx.payment.updateMany({
      where: { id: paymentId, settlementReversedAt: null },
      data: { settlementReversedAt: new Date() },
    });
    if (claim.count === 0) return;

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { bookingId: true, compensationPaid: true, booking: { select: { workerId: true } } },
    });
    if (!payment.booking.workerId) return;
    const workerProfile = await tx.workerProfile.findUnique({
      where: { userId: payment.booking.workerId },
      select: { id: true },
    });
    if (!workerProfile) return;

    const recovered = await tx.debtLedgerEntry.aggregate({
      where: { workerProfileId: workerProfile.id, bookingId: payment.bookingId, type: 'DEBT_RECOVERY' },
      _sum: { amount: true },
    });
    await restoreSettlementTx(tx, workerProfile.id, {
      bookingId: payment.bookingId,
      duesRecovered: roundToCentavo(-(recovered._sum.amount ?? 0)),
      compensationPaid: payment.compensationPaid,
    });
  });
}

export async function refundOrVoidPayment(bookingId: string, reason: string) {
  const payment = await prisma.payment.findUnique({
    where: { bookingId },
    include: { payout: true, booking: { select: { workerId: true, clientId: true } } },
  });
  if (!payment) return null;

  if (payment.status === 'PENDING') {
    return voidUnpaidPayment(bookingId, reason);
  }

  if (payment.status !== 'COMPLETED') {
    return payment;
  }

  let refund: XenditRefund | null = null;
  if (payment.methodType === 'GCASH' || payment.methodType === 'MAYA') {
    await stopWorkerPayout(payment.id, bookingId, reason);
    if (payment.xenditInvoiceId) {
      refund = await requestXenditRefund({
        id: payment.id,
        xenditInvoiceId: payment.xenditInvoiceId,
        xenditRefundId: payment.xenditRefundId,
        amountPesos: payment.capturedAmount ?? payment.totalAmount,
      });
    }
    if (!refund || refund.status === 'SUCCEEDED') {
      await undoWorkerSettlement(payment.id);
    }
    if (refund?.status === 'SUCCEEDED') {
      await postRefundSent(prisma, payment, payment.booking.workerId, payment.booking.clientId);
    }
  } else if (payment.methodType === 'CASH') {
    const workerUserId = payment.booking.workerId;
    const workerProfile = workerUserId
      ? await prisma.workerProfile.findUnique({ where: { userId: workerUserId }, select: { id: true } })
      : null;
    const platformCut = roundToCentavo(payment.commissionAmount + payment.withholdingTaxAmount);
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.payment.updateMany({
        where: { id: payment.id, status: 'COMPLETED' },
        data: { status: 'REFUNDED', escrowStatus: 'REFUNDED', refundReason: reason, refundedAt: new Date() },
      });
      if (claim.count === 0) return false;
      if (workerProfile && platformCut > 0) {
        await reverseDebtTx(tx, workerProfile.id, platformCut, {
          bookingId,
          note: `Reversed cash-job commission after refund: ${reason}`,
        });
        await postCashJobRefunded(tx, payment, workerUserId as string);
      }
      return true;
    });
    if (!claimed) return prisma.payment.findUnique({ where: { id: payment.id } });
  }

  const refunded = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'REFUNDED',
      escrowStatus: 'REFUNDED',
      refundReason: reason,
      refundedAt: new Date(),
      ...(refund ? { xenditRefundId: refund.id, xenditRefundStatus: refund.status } : {}),
    },
  });

  return refunded;
}

export async function reconcilePendingPayment(paymentId: string): Promise<'paid' | 'failed' | 'pending'> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== 'PENDING' || !payment.xenditInvoiceId) return 'pending';

  const inv = await retrieveInvoice(payment.xenditInvoiceId);
  const status = (inv?.status as string | undefined)?.toUpperCase();

  if (status === 'PAID' || status === 'SETTLED') {
    const finalized = await finalizePaidBooking(
      payment.id,
      inv.payment_id ?? null,
      inv.paid_amount ?? null,
      inv.paid_at ? new Date(inv.paid_at) : null
    );
    return finalized ? 'paid' : 'pending';
  }
  if (status === 'EXPIRED' || status === 'FAILED') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: status },
    });
    return 'failed';
  }
  return 'pending';
}
