import prisma from '@config/database';
import {
  calculateCommission,
  calculateWithholdingTax,
  computeBookingFinalTotal,
} from '@utils/pricing';
import { createInvoice, retrieveInvoice, createRefund } from '@services/xenditService';
import { notifyUser } from '@utils/notify';
import { getAppSettings } from '@services/appSettingsService';
import { schedulePayout } from '@queues/payoutQueue';
import { writeAuditLog } from '@utils/auditLog';
import { recoverDebtTx, accrueDebtTx, reverseDebtTx } from '@services/debtLedgerService';
import { roundToCentavo } from '@utils/money';

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
export async function settleCashBooking(bookingId: string) {
  const booking = await loadBooking(bookingId);
  const { commissionRate, withholdingTaxRate } = resolveRates(booking, await getAppSettings());
  const priced = priceBooking(booking, commissionRate, withholdingTaxRate);
  const platformCut = roundToCentavo(priced.commissionAmount + priced.withholdingTaxAmount);

  const { payment } = await prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { bookingId } });
    if (existing && existing.status === 'COMPLETED') {
      return { payment: existing };
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

    await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'COMPLETED', finalPrice: priced.subtotal, vatAmount: priced.vatAmount, completionDate: new Date() },
    });

    if (booking.workerId && platformCut > 0) {
      const workerProfile = await tx.workerProfile.findUnique({
        where: { userId: booking.workerId },
        select: { id: true },
      });
      if (workerProfile) {
        await accrueDebtTx(tx, workerProfile.id, platformCut, {
          bookingId,
          note: 'Commission + withholding tax on a cash job (paid to you in person)',
        });
      }
    }

    return { payment };
  });

  if (booking.workerId) {
    await notifyUser({
      userId: booking.workerId,
      type: 'PAYMENT_RECEIVED',
      title: 'Cash Job Completed',
      message:
        `You collected ₱${priced.totalAmount.toFixed(2)} in cash. ₱${platformCut.toFixed(2)} ` +
        `(commission + tax) will be deducted from your next online-job payout.`,
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
  if (existing && existing.status === 'PENDING' && existing.xenditInvoiceId) {
    try {
      const inv = await retrieveInvoice(existing.xenditInvoiceId);
      const invStatus = (inv?.status as string)?.toUpperCase();
      if (invStatus === 'PAID' || invStatus === 'SETTLED') {
        await finalizePaidBooking(
          existing.id,
          inv.payment_id ?? null,
          inv.paid_amount ?? null,
          inv.paid_at ? new Date(inv.paid_at) : null
        );
        return { alreadyPaid: true };
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

  await prisma.booking.update({
    where: { id: bookingId },
    // awaitingPaymentSince only set on the first entry into this status —
    // a retried/resumed checkout (existing PENDING invoice reused above, or
    // a fresh one minted after a failure) shouldn't push the reminder clock
    // back out, since the client has been waiting since the original one.
    data: {
      status: 'AWAITING_PAYMENT',
      finalPrice: priced.subtotal,
      awaitingPaymentSince: booking.awaitingPaymentSince ?? new Date(),
    },
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
        commissionOwed: true,
        payoutMethod: true,
        payoutAccountName: true,
        payoutAccountNumber: true,
      },
    });

    let payoutAmount = payment.workerPayout;
    if (workerProfile) {
      const debt = Math.max(0, workerProfile.commissionOwed);
      const applied = roundToCentavo(Math.min(debt, payoutAmount));
      if (applied > 0) {
        await recoverDebtTx(tx, workerProfile.id, applied, {
          bookingId: payment.bookingId,
          note: 'Withheld from payout to clear outstanding cash-job commission dues',
        });
        payoutAmount = roundToCentavo(payoutAmount - applied);
      }
    }

    let payoutId: string | null = null;
    if (payoutAmount > 0) {
      if (workerProfile?.payoutMethod && workerProfile.payoutAccountNumber) {
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
      } else {
        await writeAuditLog({
          action: 'PAYOUT_BLOCKED_NO_METHOD',
          category: 'SYSTEM_ERROR',
          message: `Worker ${workerUserId} has no payout method — payout for booking ${payment.bookingId} was not created`,
          metadata: { bookingId: payment.bookingId, workerId: workerUserId },
        });
      }
    }

    return { payoutId, payoutAmount, totalAmount: payment.totalAmount, workerUserId, bookingId: payment.bookingId };
  });

  if (!outcome) return; // settlement already claimed by another run

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

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'COMPLETED',
        escrowStatus: 'RELEASED',
        xenditPaymentId: xenditPaymentRef ?? payment.xenditPaymentId ?? null,
        capturedAmount: paidAmount ?? payment.totalAmount,
        capturedAt: paidAt ?? new Date(),
        releasedAt: new Date(),
      },
    });

    await tx.booking.update({
      where: { id: payment.bookingId },
      data: { status: 'COMPLETED', finalPrice: payment.subtotal, vatAmount: payment.vatAmount, completionDate: new Date() },
    });

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

    await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'COMPLETED', finalPrice: payment.subtotal, vatAmount: payment.vatAmount, completionDate: new Date() },
    });

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
async function flagTaxRecordsForRefundedPayment(payment: {
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

  if (payment.methodType === 'GCASH' || payment.methodType === 'MAYA') {
    if (payment.payout && payment.payout.status === 'PAID') {
      throw new Error(
        `Payout for booking ${bookingId} has already been disbursed — this refund needs a manual clawback.`
      );
    }
    if (payment.xenditInvoiceId) {
      const refund = await createRefund({
        xenditInvoiceId: payment.xenditInvoiceId,
        amountPesos: payment.capturedAmount ?? payment.totalAmount,
        reason: 'REQUESTED_BY_CUSTOMER',
      });
      if (refund.status !== 'SUCCEEDED') {
        throw new Error(
          `Xendit refund for invoice ${payment.xenditInvoiceId} did not succeed (status: ${refund.status})`
        );
      }
    }
    // Cancel a not-yet-sent payout so the worker isn't paid for a refunded job.
    if (payment.payout && (payment.payout.status === 'PENDING' || payment.payout.status === 'PROCESSING')) {
      await prisma.payout.update({
        where: { id: payment.payout.id },
        data: { status: 'FAILED', failureReason: `Booking refunded: ${reason}`, failedAt: new Date() },
      });
    }
  } else if (payment.methodType === 'CASH') {
    // Reverse the commission-debt accrual; the worker returns the cash directly.
    const workerUserId = payment.booking.workerId;
    if (workerUserId) {
      const workerProfile = await prisma.workerProfile.findUnique({
        where: { userId: workerUserId },
        select: { id: true },
      });
      const platformCut = roundToCentavo(payment.commissionAmount + payment.withholdingTaxAmount);
      if (workerProfile && platformCut > 0) {
        await prisma.$transaction((tx) =>
          reverseDebtTx(tx, workerProfile.id, platformCut, {
            bookingId,
            note: `Reversed cash-job commission after refund: ${reason}`,
          })
        );
      }
    }
  }

  const refunded = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'REFUNDED',
      escrowStatus: 'REFUNDED',
      refundReason: reason,
      refundedAt: new Date(),
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
    await finalizePaidBooking(
      payment.id,
      inv.payment_id ?? null,
      inv.paid_amount ?? null,
      inv.paid_at ? new Date(inv.paid_at) : null
    );
    return 'paid';
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
