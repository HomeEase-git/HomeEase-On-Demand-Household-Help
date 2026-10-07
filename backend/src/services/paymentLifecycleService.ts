import prisma from '@config/database';
import {
  calculateCommission,
  calculateWithholdingTax,
  computeBookingFinalTotal,
} from '@utils/pricing';
import { createInvoice, retrieveInvoice, createRefund, retrieveRefund, type XenditRefund } from '@services/xenditService';
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

// Statuses a booking may be finalized to COMPLETED from (see bookingStateMachine).
const COMPLETABLE_STATUSES = ['PENDING_COMPLETION', 'AWAITING_PAYMENT', 'DISPUTED'] as const;

/**
 * PAYMENT MODEL: pay-after-completion, no escrow.
 *
 * No Payment row exists until the client confirms the finished job. At that
 * point (bookingController.confirmCompletion):
 *
 *   CASH   -> settleCashBooking: the client already paid the worker in person,
 *             so the booking is finalized immediately and the platform's
 *             commission + withholding tax are accrued onto the worker's
 *             commissionOwed tab (netted from their next online payout).
 *
 *   GCASH  -> createCompletionInvoice: a Xendit invoice for the full final
 *   /MAYA     total is raised and the booking moves to AWAITING_PAYMENT. The
 *             invoice-paid webhook calls finalizePaidBooking, which finalizes
 *             the booking, nets any outstanding commissionOwed, and schedules
 *             the worker's payout for the remainder.
 *
 * `Payment.escrowStatus` is vestigial (see schema): HELD = unsettled,
 * RELEASED = settled, REFUNDED = refunded. Nothing is ever held by the
 * platform.
 */

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
    // Only approved add-ons count toward settlement — see
    // BookingAddOn.clientApprovedAt's schema comment. By the time a booking
    // reaches settlement, add-ons are already frozen (completeBooking
    // auto-rejects anything still pending), so this should already match
    // what was locked into Booking.finalPrice — filtering here too keeps
    // this the single source of truth rather than trusting that agreement.
    include: { addOns: { where: { clientApprovedAt: { not: null } } } },
  });
  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  return booking as unknown as BookingWithAddOns;
}

/**
 * The commission/withholding-tax rate a booking actually settles at.
 * Prefers the snapshot pinned in bookingController.acceptBooking (see
 * Booking.commissionRateSnapshot's schema comment) over the live
 * AppSettings value, so an admin changing the platform rate after a worker
 * already accepted a job can't retroactively change their split. Falls
 * back to the live settings only for bookings accepted before this field
 * existed (snapshot null) — identical to the old, always-live behavior.
 */
function resolveRates(
  booking: Pick<BookingWithAddOns, 'commissionRateSnapshot' | 'withholdingTaxRateSnapshot'>,
  liveSettings: { commissionRate: number; withholdingTaxRate: number }
) {
  return {
    commissionRate: booking.commissionRateSnapshot ?? liveSettings.commissionRate,
    withholdingTaxRate: booking.withholdingTaxRateSnapshot ?? liveSettings.withholdingTaxRate,
  };
}

/**
 * vatApplicable/vatRate are always read from the booking's own frozen
 * snapshot (see Booking.vatApplicable/vatRate) — never re-derived from the
 * worker's live WorkerProfile.vatRegistered — so a worker becoming
 * VAT-registered mid-job can't shift a price the client already agreed to.
 */
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
  // VAT is never the worker's or platform's revenue (it's collected on BIR's
  // behalf) — added back after commission/withholding are taken out, never
  // taxed or commissioned itself.
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

/**
 * CASH completion. The client has paid the worker directly, so this only
 * records the transaction and books the platform's uncollected cut as worker
 * debt. No gateway call, no Payout.
 */
function cashJobDuesMessage(collected: number, platformCut: number, coveredByCredit: number): string {
  const owed = roundToCentavo(platformCut - coveredByCredit);
  const intro = `You collected ₱${collected.toFixed(2)} in cash. The ₱${platformCut.toFixed(2)} commission + tax`;
  if (owed <= 0) return `${intro} was covered by your payout credit — nothing to pay.`;
  if (coveredByCredit > 0) {
    return (
      `${intro} was partly covered by your ₱${coveredByCredit.toFixed(2)} payout credit. ` +
      `The remaining ₱${owed.toFixed(2)} will be deducted from your next online-job payout.`
    );
  }
  return `${intro} will be deducted from your next online-job payout.`;
}

export async function settleCashBooking(bookingId: string) {
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
      // Cash is settled worker-to-hand — no Payout is ever owed, so mark the
      // worker side settled up front (blocks settleWorkerEarnings / the
      // self-heal sweep from ever creating a disbursement for this payment).
      workerSettledAt: new Date(),
      methodType: 'CASH' as const,
      accountIdentifier: booking.paymentAccountIdentifier ?? null,
    };

    const payment = existing
      ? await tx.payment.update({ where: { id: existing.id }, data: paymentData })
      : await tx.payment.create({ data: { bookingId, ...paymentData } });

    await updateBookingIfStatus(tx, bookingId, COMPLETABLE_STATUSES, {
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

/**
 * GCASH/MAYA completion. Raises a Xendit invoice for the full final total and
 * moves the booking to AWAITING_PAYMENT. Idempotent: if a still-PENDING
 * Payment with a live invoice already exists (client abandoned an earlier
 * checkout), its URL is returned instead of creating a duplicate.
 */
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

  // Reuse a still-open invoice from an abandoned checkout — or, if Xendit
  // already shows it PAID (the invoice-paid webhook was missed/delayed),
  // self-heal right here instead of minting a duplicate invoice and charging
  // the client a second time.
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
  // The client already paid part of the old invoice; a fresh full-amount
  // invoice would charge them again.
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

  // Status-guarded: a fast invoice-paid webhook may already have moved the
  // booking to COMPLETED between createInvoice and here — never drag it back.
  // awaitingPaymentSince only set on the first entry into this status —
  // a retried/resumed checkout (existing PENDING invoice reused above, or
  // a fresh one minted after a failure) shouldn't push the reminder clock
  // back out, since the client has been waiting since the original one.
  await updateBookingIfStatus(prisma, bookingId, ['PENDING_COMPLETION', 'AWAITING_PAYMENT'], {
    status: 'AWAITING_PAYMENT',
    finalPrice: priced.subtotal,
    awaitingPaymentSince: booking.awaitingPaymentSince ?? new Date(),
  });

  return { checkoutUrl: invoice.invoiceUrl, invoiceId: invoice.id, paymentId: payment.id, amount: priced.totalAmount };
}

/**
 * Nets any outstanding worker commission dues against this payment's workerPayout
 * and creates a Payout row for the remainder, then enqueues the disbursement.
 *
 * The claim + debt-netting + Payout-row insert all happen in ONE transaction
 * guarded by `Payment.workerSettledAt`, so a replayed webhook or the
 * bookingWorker self-heal sweep can never net the debt or create a second
 * payout. Only `schedulePayout` (the BullMQ enqueue) runs afterwards — if that
 * fails the Payout row is left PENDING and the reconciliation sweep re-enqueues
 * it (jobId dedup makes that safe).
 */
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

/**
 * Audit + tell the worker, once per booking — the self-heal sweep retries a
 * held payment every run, so without the dedup the worker would be re-notified
 * hourly until they add a payout account.
 */
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
    // Atomic claim — only the first caller flips workerSettledAt from null.
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
      // recoverDebtTx locks the worker's dues row and takes at most what's
      // owed right now, so a penalty or refund landing concurrently can't be
      // lost or double-counted.
      const recovered = await recoverDebtTx(tx, workerProfile.id, payoutAmount, {
        bookingId: payment.bookingId,
        note: 'Withheld from payout to clear outstanding platform dues',
      });
      payoutAmount = roundToCentavo(payoutAmount - recovered);

      // Approved client-fault cancellation compensation (and credit left
      // over from refunds) rides along with the next online payout. Recorded
      // on the payment so a refund of this job can put it back.
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
        // Roll back the claim (and any debt netting) so the payment stays
        // unsettled — the self-heal sweep retries it once the worker adds a
        // payout account, instead of the earnings being silently dropped.
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
      // Payout row is PENDING; the reconciliation sweep will re-enqueue it.
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

/**
 * Called by the Xendit invoice-paid webhook (paymentController.handleInvoicePaid)
 * and by the reconciliation sweep. Marks the Payment COMPLETED, finalizes the
 * booking, then settles the worker's earnings. Idempotent — a Payment already
 * COMPLETED short-circuits to settleWorkerEarnings so a missing payout still
 * self-heals.
 *
 * Returns null (and changes nothing) when Xendit reports less money paid than
 * the invoice total — the booking is not marked paid and no payout is made
 * until an admin has looked at it.
 */
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

  if (paidAmount != null && roundToCentavo(paidAmount) < roundToCentavo(payment.totalAmount)) {
    await writeAuditLog({
      action: 'PAYMENT_UNDERPAID',
      category: 'SYSTEM_ERROR',
      level: 'ERROR',
      message:
        `Xendit reports ₱${paidAmount.toFixed(2)} paid for booking ${payment.bookingId}, ` +
        `but the invoice total is ₱${payment.totalAmount.toFixed(2)} — not marked paid, review it manually.`,
      metadata: { paymentId: payment.id, bookingId: payment.bookingId, paidAmount, totalAmount: payment.totalAmount },
    });
    return null;
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Claim the payment: a concurrent webhook/reconcile for the same invoice
      // that already marked it COMPLETED makes this one a no-op.
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

      await postPaymentCaptured(tx, p, payment.booking.workerId);

      // If the payment-overdue sweep already opened a dispute and the client
      // then paid, close it out.
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
      // Money arrived for a booking that was cancelled (or otherwise moved
      // on) in the meantime. Don't mark it completed — leave the payment
      // PENDING and flag it so an admin refunds or reinstates it.
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
    // Lost the race to another finalizer — it settles; this just self-heals.
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

/**
 * Admin override for a post-completion non-payment dispute (see
 * adminDisputeController's PAY_WORKER_FROM_PLATFORM action) — the platform
 * settles the worker's earnings out of its own funds rather than continue
 * chasing a client who confirmed the job but never paid. Requires an
 * existing Payment (created by createCompletionInvoice when the booking
 * entered AWAITING_PAYMENT) so this can reuse its already-computed
 * subtotal/commission/withholdingTax/VAT/workerPayout split — the worker
 * still received real taxable income regardless of who funded it, so 2307/
 * withholding reporting stays correct — but marks `platformFunded` so
 * vatSummaryService excludes it from "VAT collected from clients"
 * reporting, since no client payment ever happened. Idempotent the same way
 * finalizePaidBooking is: an already-COMPLETED payment just re-runs
 * settleWorkerEarnings (safe no-op if already settled).
 */
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

/**
 * Marks a still-unpaid Payment as FAILED (its Xendit invoice, if any, expires
 * on Xendit's side). Used when a booking is cancelled while awaiting payment.
 * A no-op when there is no Payment row.
 */
export async function voidUnpaidPayment(bookingId: string, reason: string) {
  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  if (!payment || payment.status !== 'PENDING') return payment ?? null;

  return prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED', failureReason: reason, escrowStatus: 'REFUNDED', refundReason: reason, refundedAt: new Date() },
  });
}

/**
 * Refund/void for cancellations and dispute resolutions.
 *
 *  - No Payment / PENDING Payment  -> nothing was collected; void it.
 *  - COMPLETED + GCASH/MAYA        -> real Xendit refund (only mark REFUNDED on
 *                                     SUCCEEDED; throw otherwise for manual
 *                                     follow-up). Refused if the worker payout
 *                                     already went out (needs manual clawback).
 *  - COMPLETED + CASH             -> reverse the worker's commission-debt
 *                                     accrual; the worker returns the cash
 *                                     out-of-band.
 */
/**
 * Called after a COMPLETED payment is refunded — taxCertificateService/
 * taxRemittanceService/vatSummaryService all aggregate Payment rows by
 * `capturedAt` falling in a period at generation time only, with no later
 * reconciliation if one of those payments is subsequently refunded. Left
 * unchecked, an already-ISSUED 2307 or already-REMITTED period keeps
 * overstating real income/tax withheld forever, and a worker's VAT-
 * collected summary keeps counting VAT that was never actually kept.
 * Flags (never silently corrects — the real remediation is a human
 * decision) any record whose stored period contains this payment's
 * capturedAt, and notifies admins once if anything was flagged.
 */
export async function flagTaxRecordsForRefundedPayment(payment: {
  id: string;
  bookingId: string;
  capturedAt: Date | null;
  vatAmount: number;
  booking: { workerId: string | null };
}): Promise<void> {
  if (!payment.capturedAt || !payment.booking.workerId) return;
  const workerId = payment.booking.workerId;
  const capturedAt = payment.capturedAt;

  const [certificates, remittances, vatSummaries] = await Promise.all([
    prisma.taxCertificate.findMany({
      where: { workerId, status: 'ISSUED', periodStart: { lte: capturedAt }, periodEnd: { gt: capturedAt } },
    }),
    prisma.taxRemittance.findMany({
      where: { status: 'REMITTED', periodStart: { lte: capturedAt }, periodEnd: { gt: capturedAt } },
    }),
    payment.vatAmount > 0
      ? prisma.vatCollectionSummary.findMany({
          where: { workerId, needsReview: false, periodStart: { lte: capturedAt }, periodEnd: { gt: capturedAt } },
        })
      : Promise.resolve([]),
  ]);

  if (certificates.length === 0 && remittances.length === 0 && vatSummaries.length === 0) return;

  await Promise.all([
    ...certificates.map((c) => prisma.taxCertificate.update({ where: { id: c.id }, data: { status: 'NEEDS_REVIEW' } })),
    ...remittances.map((r) => prisma.taxRemittance.update({ where: { id: r.id }, data: { status: 'NEEDS_REVIEW' } })),
    ...vatSummaries.map((v) => prisma.vatCollectionSummary.update({ where: { id: v.id }, data: { needsReview: true } })),
  ]);

  await writeAuditLog({
    action: 'TAX_RECORDS_FLAGGED_FOR_REVIEW',
    category: 'SYSTEM_ERROR',
    level: 'WARN',
    message: `Payment ${payment.id} (booking ${payment.bookingId}) was refunded after being counted in ${certificates.length} tax certificate(s), ${remittances.length} remittance period(s), and ${vatSummaries.length} VAT summary(ies) — flagged for admin review.`,
    metadata: { paymentId: payment.id, bookingId: payment.bookingId, workerId },
  });

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
  await Promise.all(
    admins.map((admin) =>
      notifyUser({
        userId: admin.id,
        type: 'TAX_RECORDS_NEED_REVIEW',
        title: 'Tax records need review after refund',
        message: `A refunded payment (booking ${payment.bookingId}) was already counted in issued tax records — review and correct before the next filing.`,
        relatedId: payment.bookingId,
      })
    )
  );
}

/** The worker's payout already left — the refund has to be settled manually. */
export class PayoutAlreadySentError extends Error {
  constructor(bookingId: string) {
    super(`Payout for booking ${bookingId} has already been disbursed — this refund needs a manual clawback.`);
  }
}

/** The payout worker is mid-send; the refund can simply be retried shortly. */
export class PayoutInFlightError extends Error {
  constructor(bookingId: string) {
    super(`Payout for booking ${bookingId} is being sent right now — retry the refund in a minute.`);
  }
}

function manualClawbackError(bookingId: string) {
  return new PayoutAlreadySentError(bookingId);
}

/**
 * Makes sure no worker payout goes out for a payment that is about to be
 * refunded. In order:
 *  - not settled yet: take the same `workerSettledAt` claim settleWorkerEarnings
 *    uses, so a payout is never created for it;
 *  - payout queued (PENDING) or FAILED: cancel it here — the payout worker and
 *    admin retry only ever send PENDING/FAILED rows;
 *  - payout already at Xendit (PROCESSING): cancel it at Xendit, which only
 *    works while Xendit still holds it;
 *  - otherwise the money is gone and the refund is refused (manual clawback).
 * The lock stays even if the refund then fails, so a retried refund can't
 * race a payout either.
 */
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

  // No Payout row: the whole amount went to the worker's dues.
  const payout = await prisma.payout.findUnique({ where: { paymentId } });
  if (!payout || payout.status === 'CANCELLED') return;
  if (payout.status === 'PAID') throw manualClawbackError(bookingId);
  if ((await cancelIfNotSent()).count === 1) return;

  const inFlight = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
  if (inFlight.status === 'CANCELLED') return;
  if (inFlight.status !== 'PROCESSING') throw manualClawbackError(bookingId);
  const xenditPayoutId = inFlight.xenditDisbursementId;
  if (!xenditPayoutId) {
    // The payout worker is between claiming it and hearing back from Xendit.
    throw new PayoutInFlightError(bookingId);
  }

  const remoteStatus = await cancelPayout(xenditPayoutId)
    .then((r) => r.status)
    // Xendit refuses the cancel once it has handed the money on — find out where it is.
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

/**
 * Refunds the client through Xendit at most once. An earlier refund that is
 * PENDING or SUCCEEDED is reused; only a FAILED/CANCELLED one is retried,
 * under a new idempotency key (Xendit would otherwise replay the failure).
 */
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

  // PENDING is normal for e-wallets: Xendit has accepted it and the sweep
  // follows it up (reconcilePendingRefund).
  if (refund.status !== 'SUCCEEDED' && refund.status !== 'PENDING') {
    throw new Error(`Xendit refund for invoice ${payment.xenditInvoiceId} did not succeed (status: ${refund.status})`);
  }
  return refund;
}

/**
 * Sweep follow-up for a refund Xendit accepted as PENDING. If it later
 * fails, the client never got their money: the payment goes back to
 * COMPLETED (the worker's payout stays stopped) so the refund can be retried,
 * and the failure is logged for an admin.
 */
export async function reconcilePendingRefund(paymentId: string): Promise<'succeeded' | 'failed' | 'pending'> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.xenditRefundId || payment.xenditRefundStatus !== 'PENDING') return 'pending';

  const refund = await retrieveRefund(payment.xenditRefundId);
  if (refund.status === 'SUCCEEDED') {
    await prisma.payment.update({ where: { id: payment.id }, data: { xenditRefundStatus: 'SUCCEEDED' } });
    await undoWorkerSettlement(payment.id);
    const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId }, select: { workerId: true } });
    await postRefundSent(prisma, payment, booking?.workerId ?? null);
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

/**
 * Undoes an online payment's worker settlement after its payout was stopped
 * for a refund: dues recovered from that payout go back on the worker's tab
 * and compensation credit that rode along is restored. Runs once per payment
 * (claim on settlementReversedAt); a no-op when nothing was settled.
 */
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
    include: { payout: true, booking: { select: { workerId: true } } },
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
    // Stop the worker's payout BEFORE money goes back to the client, so the
    // same peso can never leave twice. Throws if it has already been sent.
    await stopWorkerPayout(payment.id, bookingId, reason);
    if (payment.xenditInvoiceId) {
      refund = await requestXenditRefund({
        id: payment.id,
        xenditInvoiceId: payment.xenditInvoiceId,
        xenditRefundId: payment.xenditRefundId,
        amountPesos: payment.capturedAmount ?? payment.totalAmount,
      });
    }
    // Dues netted from this job's (now stopped) payout weren't really paid
    // once the client has their money back — so undo the settlement only
    // when the refund has actually succeeded. A PENDING refund is undone by
    // the sweep when it completes (reconcilePendingRefund); one that fails
    // leaves the worker's dues untouched.
    if (!refund || refund.status === 'SUCCEEDED') {
      await undoWorkerSettlement(payment.id);
    }
    if (refund?.status === 'SUCCEEDED') {
      await postRefundSent(prisma, payment, payment.booking.workerId);
    }
  } else if (payment.methodType === 'CASH') {
    // Reverse the commission-debt accrual; the worker returns the cash
    // directly. The status claim and the reversal commit together, so a
    // repeated refund call can't reverse the dues twice.
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

  await flagTaxRecordsForRefundedPayment(payment);

  return refunded;
}

/**
 * Reconciliation helper (bookingWorker sweep): pull the real invoice state
 * from Xendit for a Payment stuck PENDING and self-heal a missed webhook.
 */
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
