import type { Prisma, PaymentMethodType } from '@prisma/client';
import prisma from '@config/database';
import { calculateCommission, calculateWithholdingTax } from '@utils/pricing';
import { createRefund } from '@services/xenditService';
import { notifyUser } from '@utils/notify';
import { getAppSettings } from '@services/appSettingsService';
import { schedulePayout } from '@queues/payoutQueue';
import { writeAuditLog } from '@utils/auditLog';

export interface BookingForPayment {
  id: string;
  estimatedPrice: number;
  tip: number | null;
  paymentMethodType: PaymentMethodType | null;
  paymentAccountIdentifier: string | null;
}

/**
 * Creates the Payment row at booking-creation time in an "authorized" state:
 * status PENDING, escrowStatus HELD, authorizedAmount/authorizedAt set.
 *
 * GCASH/MAYA need the client to complete a Xendit Invoice checkout (see
 * paymentController.createXenditCheckout, unchanged); once Xendit reports
 * the invoice paid, the webhook (handleInvoicePaid) marks the Payment
 * COMPLETED but leaves escrowStatus HELD until this booking is actually
 * confirmed complete (see captureAndReleasePayment). CASH has no gateway
 * automation — the amount is recorded as authorized for bookkeeping and
 * settled off-platform.
 */
export async function authorizePaymentForBooking(
  tx: Prisma.TransactionClient,
  booking: BookingForPayment,
  addOnsTotal: number
) {
  const { commissionRate, withholdingTaxRate } = await getAppSettings();
  const methodType: PaymentMethodType = booking.paymentMethodType ?? 'CASH';
  const subtotal = booking.estimatedPrice + addOnsTotal;
  const tip = booking.tip ?? 0;
  const commission = calculateCommission(subtotal, commissionRate);
  const withholdingTax = calculateWithholdingTax(subtotal, commissionRate, withholdingTaxRate);
  const workerPayout = subtotal - commission - withholdingTax + tip;
  const totalAmount = subtotal + tip;

  return tx.payment.create({
    data: {
      bookingId: booking.id,
      subtotal,
      tip,
      commissionRate,
      commissionAmount: commission,
      withholdingTaxRate,
      withholdingTaxAmount: withholdingTax,
      workerPayout,
      totalAmount,
      status: 'PENDING',
      escrowStatus: 'HELD',
      authorizedAmount: totalAmount,
      authorizedAt: new Date(),
      methodType,
      accountIdentifier: booking.paymentAccountIdentifier ?? null,
    },
  });
}

/**
 * Captures the held authorization and releases escrow to the worker. Called
 * once the client confirms a booking's completion. Idempotent — a payment
 * whose escrow is already RELEASED is returned as-is.
 *
 * `finalAmount` is the final SUBTOTAL (labor+materials+add-ons, or
 * estimatedPrice+add-ons — see bookingController.confirmCompletion) and can
 * differ from what was authorized at booking-creation time (a quote was
 * approved, or add-ons were added mid-job). commissionAmount/
 * withholdingTaxAmount/workerPayout are therefore recomputed here against
 * the current AppSettings rates and the real final subtotal, rather than
 * reusing the estimate-time figures — otherwise admin financial reporting
 * would silently go stale on any quote/add-on job.
 *
 * Known limitation: no payment method here supports collecting a price
 * increase at this step. GCash/Maya are charged in full up front
 * (handleInvoicePaid, paymentController.ts) and CASH settles
 * off-platform — for both this recompute updates the platform's bookkeeping
 * (commission/tax/payout math) to match the final agreed price, but does not
 * and cannot collect any difference from the client. A quote/add-on that
 * increases the price needs a separate manual-collection step; not built
 * here.
 */
export async function captureAndReleasePayment(
  bookingId: string,
  finalAmount: number,
  workerId: string | null
) {
  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  if (!payment) {
    throw new Error('Payment not found for booking');
  }

  if (payment.escrowStatus === 'RELEASED') {
    return payment;
  }

  const { commissionRate, withholdingTaxRate } = await getAppSettings();
  const subtotal = finalAmount;
  const tip = payment.tip;
  const commissionAmount = calculateCommission(subtotal, commissionRate);
  const withholdingTaxAmount = calculateWithholdingTax(subtotal, commissionRate, withholdingTaxRate);
  const workerPayout = subtotal - commissionAmount - withholdingTaxAmount + tip;
  const totalAmount = subtotal + tip;

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      subtotal,
      commissionRate,
      commissionAmount,
      withholdingTaxRate,
      withholdingTaxAmount,
      workerPayout,
      totalAmount,
      capturedAmount: totalAmount,
      capturedAt: new Date(),
      status: 'COMPLETED',
      escrowStatus: 'RELEASED',
      releasedAt: new Date(),
    },
  });

  if (workerId) {
    // Wrapped so a Redis/Xendit hiccup here never fails escrow release
    // itself — the escrow update above already committed.
    try {
      const workerProfile = await prisma.workerProfile.findUnique({
        where: { userId: workerId },
        select: { payoutMethod: true, payoutAccountName: true, payoutAccountNumber: true },
      });

      if (workerProfile?.payoutMethod && workerProfile.payoutAccountNumber) {
        const payout = await prisma.payout.create({
          data: {
            paymentId: updated.id,
            bookingId,
            workerId,
            amount: updated.workerPayout,
            channel: workerProfile.payoutMethod,
            accountName: workerProfile.payoutAccountName,
            accountNumber: workerProfile.payoutAccountNumber,
          },
        });
        await schedulePayout(payout.id);
      } else {
        await writeAuditLog({
          action: 'PAYOUT_BLOCKED_NO_METHOD',
          category: 'SYSTEM_ERROR',
          message: `Worker ${workerId} has no payout method configured — payout for booking ${bookingId} was not created`,
          metadata: { bookingId, workerId },
        });
      }
    } catch (error) {
      console.error(`Failed to create/schedule payout for booking ${bookingId}:`, error);
    }

    await notifyUser({
      userId: workerId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment Released',
      message: `₱${updated.workerPayout.toFixed(2)} has been released to your account`,
      relatedId: bookingId,
    });
  }

  return updated;
}

/**
 * Releases a held escrow back to the client without paying the worker —
 * used for cancellations/refunds. An authorization that was never charged
 * (a GCash/Maya invoice never paid) simply expires on Xendit's side, nothing
 * to reverse. But money CAN already be with the platform while escrow is
 * still HELD: GCash/Maya are charged as soon as the invoice is paid
 * (handleInvoicePaid, paymentController.ts), well before the job — and
 * completion capture also sets status COMPLETED — so `status === 'COMPLETED'`
 * with a real `xenditInvoiceId` means a genuine refund must be issued via
 * Xendit, not just a DB status flip. Xendit's refund call is keyed by the
 * invoice id, not a separate payment id.
 */
export async function refundOrVoidPayment(bookingId: string, reason: string) {
  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  if (!payment) return null;
  if (payment.escrowStatus !== 'HELD') return payment;

  if (payment.status === 'COMPLETED' && payment.xenditInvoiceId) {
    // Don't mark REFUNDED in our DB unless the gateway refund actually
    // succeeded — leaving escrowStatus HELD on failure so it's visible for
    // manual follow-up rather than silently lying about the client's money.
    await createRefund({
      xenditInvoiceId: payment.xenditInvoiceId,
      amountPesos: payment.capturedAmount ?? payment.totalAmount,
      reason,
    });
  }

  return prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: payment.status === 'COMPLETED' ? 'REFUNDED' : 'FAILED',
      escrowStatus: 'REFUNDED',
      refundReason: reason,
      refundedAt: new Date(),
    },
  });
}
