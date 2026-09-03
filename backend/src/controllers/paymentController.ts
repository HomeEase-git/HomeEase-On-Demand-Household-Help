import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';
import {
  refundOrVoidPayment,
  finalizePaidBooking,
  createCompletionInvoice,
} from '@services/paymentLifecycleService';
import { translateXenditFailureReason } from '@utils/xenditFailureMessages';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// NOTE: `createPayment` (POST /api/payments/:bookingId) and `releaseEscrow`
// (POST /api/payments/:id/release) were removed with the move to
// pay-after-completion. Payment rows are now created by
// paymentLifecycleService.settleCashBooking / createCompletionInvoice, driven
// from bookingController.confirmCompletion.

/**
 * GET /api/payments/:bookingId
 * Get payment detail/receipt data
 */
export const getPaymentDetail = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const bookingId = req.params.bookingId as string;
    const currentUserId = req.user.userId;

    // Payment.bookingId is @unique so findUnique is correct
    const payment = await prisma.payment.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: {
            addOns: true,
            client: true,
            worker: true,
            serviceTask: true,
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json(errorResponse(404, 'Payment not found'));
    }

    // Ownership check via booking (Payment has no clientId/workerId directly)
    if (
      payment.booking.clientId !== currentUserId &&
      payment.booking.workerId !== currentUserId
    ) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to view this payment'));
    }

    // Built from the payment's own stored fields (not recomputed from live
    // config) so the breakdown always reflects the rate actually charged,
    // even after an admin changes the platform commission/tax rate later.
    const breakdown = {
      subtotal: payment.subtotal,
      commissionAmount: payment.commissionAmount,
      commissionPercentage: payment.commissionRate * 100,
      withholdingTaxAmount: payment.withholdingTaxAmount,
      withholdingTaxPercentage: payment.withholdingTaxRate * 100,
      platformFee: 0,
      tip: payment.tip,
      total: payment.totalAmount,
      workerPayout: payment.workerPayout,
      platformProfit: payment.commissionAmount,
    };

    return res.status(200).json({
      success: true,
      message: 'Payment details retrieved successfully',
      data: {
        id: payment.id,
        bookingId: payment.bookingId,
        clientName: payment.booking.client.fullName,
        workerName: payment.booking.worker?.fullName ?? null,
        serviceName: payment.booking.serviceTask?.name ?? payment.booking.serviceType,
        status: payment.status,
        escrowStatus: payment.escrowStatus,
        methodType: payment.methodType,
        priceBreakdown: breakdown,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        // schema has no receivedAt; use createdAt as proxy
        receivedAt: payment.createdAt,
        releasedAt: payment.releasedAt,
        // schema has xenditPaymentId, not paymentMethodReference
        transactionId: payment.xenditPaymentId ?? null,
        ...(payment.status === 'FAILED'
          ? { failureReason: payment.failureReason, failureMessage: translateXenditFailureReason(payment.failureReason) }
          : {}),
      },
    });
  } catch (error) {
    console.error('Error fetching payment detail:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch payment details'));
  }
};

/**
 * GET /api/payments/me
 * List payments (client: payments made, worker: payouts)
 *
 * Payment has no clientId/workerId — filter via booking relation.
 */
export const listMyPayments = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { status, page = '1', limit = '10' } = req.query;
    const currentUserId = req.user.userId;
    const currentRole = req.user.role;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Filter through booking since Payment has no direct clientId/workerId
    const bookingFilter =
      currentRole === 'CLIENT'
        ? { clientId: currentUserId }
        : { workerId: currentUserId };

    const whereClause: any = {
      booking: bookingFilter,
    };

    if (status && typeof status === 'string') {
      whereClause.status = status;
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: whereClause,
        include: {
          booking: {
            include: {
              client: { select: { fullName: true } },
              worker: { select: { fullName: true } },
              serviceTask: { select: { name: true } },
            },
          },
          payout: { select: { status: true, failureReason: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.payment.count({ where: whereClause }),
    ]);

    const formattedPayments = payments.map((p) => ({
      id: p.id,
      bookingId: p.bookingId,
      service: p.booking.serviceTask?.name ?? p.booking.serviceType,
      otherParty:
        currentRole === 'CLIENT'
          ? p.booking.worker?.fullName ?? null
          : p.booking.client.fullName,
      amount: currentRole === 'CLIENT' ? p.subtotal : p.workerPayout,
      status: p.status,
      escrowStatus: p.escrowStatus,
      methodType: p.methodType,
      createdAt: p.createdAt,
      // Only meaningful for workers — tracks the actual Xendit payout to
      // their account, separate from `status` (which only reflects the
      // client's payment/escrow, not whether the worker has been paid).
      ...(currentRole === 'WORKER'
        ? {
            payoutStatus: p.payout?.status ?? null,
            payoutFailureReason: p.payout?.failureReason ?? null,
            payoutFailureMessage: p.payout?.failureReason
              ? translateXenditFailureReason(p.payout.failureReason)
              : null,
          }
        : p.status === 'FAILED'
          ? { failureReason: p.failureReason, failureMessage: translateXenditFailureReason(p.failureReason) }
          : {}),
    }));

    return res.status(200).json({
      success: true,
      message: 'Payments retrieved successfully',
      data: {
        payments: formattedPayments,
        summary: {
          total,
          totalAmount: payments.reduce(
            (sum, p) => sum + (currentRole === 'CLIENT' ? p.subtotal : p.workerPayout),
            0
          ),
          pendingCount: payments.filter((p) => p.status === 'PENDING').length,
          completedCount: payments.filter((p) => p.status === 'COMPLETED').length,
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Error listing payments:', error);
    return res.status(500).json(errorResponse(500, 'Failed to list payments'));
  }
};

/**
 * POST /api/payments/:id/refund
 * Client-initiated refund request.
 *
 *  - Payment still PENDING (unpaid GCash/Maya) -> void it directly.
 *  - Payment COMPLETED -> money has already moved, so this opens a Dispute for
 *    an admin to review; the actual refund happens in dispute resolution
 *    (adminDisputeController -> refundOrVoidPayment).
 */
export const refundPayment = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can request refunds'));
    }

    const id = req.params.id as string;
    const currentUserId = req.user.userId;
    const { reason } = req.body;
    const trimmedReason =
      typeof reason === 'string' && reason.trim() ? reason.trim() : 'Refund requested by client';

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { booking: true },
    });

    if (!payment) {
      return res.status(404).json(errorResponse(404, 'Payment not found'));
    }
    if (payment.booking.clientId !== currentUserId) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to refund this payment'));
    }

    if (payment.status === 'REFUNDED' || payment.status === 'FAILED') {
      return res.status(409).json(errorResponse(409, `Nothing to refund — payment is ${payment.status}`));
    }

    // Unpaid -> just void it, no dispute needed.
    if (payment.status === 'PENDING') {
      const updated = await refundOrVoidPayment(payment.bookingId, trimmedReason);
      return res.status(200).json({
        success: true,
        message: 'Pending payment cancelled',
        data: { id: updated?.id ?? payment.id, status: updated?.status ?? 'FAILED' },
      });
    }

    // COMPLETED -> route through a Dispute for admin review.
    const existingOpen = await prisma.dispute.findFirst({
      where: { bookingId: payment.bookingId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    });
    const dispute =
      existingOpen ??
      (await prisma.dispute.create({
        data: {
          bookingId: payment.bookingId,
          raisedById: currentUserId,
          reason: `Refund requested: ${trimmedReason}`,
          status: 'OPEN',
        },
      }));

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isDeleted: false },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        notifyUser({
          userId: admin.id,
          type: 'PAYMENT_REFUNDED',
          title: 'Refund Requested',
          message: `A client requested a refund on booking ${payment.bookingId}: ${trimmedReason}`,
          relatedId: dispute.id,
        })
      )
    );

    return res.status(202).json({
      success: true,
      message: 'Refund request submitted for review',
      data: { disputeId: dispute.id, status: 'UNDER_REVIEW' },
    });
  } catch (error) {
    console.error('Error handling refund request:', error);
    return res.status(500).json(errorResponse(500, 'Failed to submit refund request'));
  }
};

/**
 * POST /api/payments/:bookingId/xendit/checkout
 * Resume payment for a GCash/Maya booking that is AWAITING_PAYMENT (the client
 * abandoned or failed an earlier checkout). Returns the live hosted invoice
 * URL, or mints a fresh invoice if the previous one expired/failed. Delegates
 * to createCompletionInvoice, which owns the reuse-vs-recreate logic.
 */
export const createXenditCheckout = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can start a Xendit checkout'));
    }

    const bookingId = req.params.bookingId as string;
    const currentUserId = req.user.userId;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { clientId: true, status: true, paymentMethodType: true },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.clientId !== currentUserId) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to pay for this booking'));
    }
    if (booking.status !== 'AWAITING_PAYMENT' && booking.status !== 'PENDING_COMPLETION') {
      return res
        .status(409)
        .json(errorResponse(409, `Cannot start checkout for a booking with status ${booking.status}`));
    }
    if (booking.paymentMethodType !== 'GCASH' && booking.paymentMethodType !== 'MAYA') {
      return res.status(400).json(errorResponse(400, 'Xendit checkout is only available for GCash and Maya'));
    }

    const invoice = await createCompletionInvoice(bookingId);

    return res.status(200).json({
      success: true,
      message: 'Xendit checkout ready',
      data: {
        checkoutUrl: invoice.checkoutUrl,
        invoiceId: invoice.invoiceId,
        amount: invoice.amount,
      },
    });
  } catch (error) {
    console.error('Error creating Xendit checkout:', error);
    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'XENDIT_CHECKOUT_ERROR',
      category: 'SYSTEM_ERROR',
      level: 'ERROR',
      message: `Xendit checkout creation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return res.status(500).json(errorResponse(500, 'Failed to create Xendit checkout'));
  }
};

/**
 * Compares the `x-callback-token` header Xendit sends on every webhook
 * against the configured secret (the static token set in the Xendit
 * dashboard's Webhooks settings). Unlike PayMongo there is no HMAC/timestamp
 * — it's a plain shared-secret header — but crypto.timingSafeEqual is still
 * used for the comparison to avoid a timing side-channel on the token value.
 */
function verifyXenditCallbackToken(headerToken: string | string[] | undefined, secret: string): boolean {
  if (typeof headerToken !== 'string' || !headerToken) return false;

  const headerBuffer = Buffer.from(headerToken, 'utf8');
  const secretBuffer = Buffer.from(secret, 'utf8');

  // timingSafeEqual requires equal-length buffers; a length mismatch is
  // itself proof of an invalid token, safe to short-circuit on.
  if (headerBuffer.length !== secretBuffer.length) return false;

  return crypto.timingSafeEqual(headerBuffer, secretBuffer);
}

/**
 * Handles a paid Xendit invoice for a booking completion payment: hands off to
 * paymentLifecycleService.finalizePaidBooking, which marks the Payment
 * COMPLETED, finalizes the booking, nets any outstanding worker commission dues
 * and schedules the payout.
 *
 * `invoice` is the raw Xendit invoice payload from the webhook body — shape
 * UNCONFIRMED against a real payload (docs domains were network-blocked
 * when this was built); this reads the fields the hand-validated
 * GET /v2/invoices/{id} response returned (`id`, `status`, `payment_id`,
 * `paid_amount`, `paid_at`) and defensively no-ops if any are missing rather
 * than throwing.
 */
async function handleInvoicePaid(invoice: any) {
  const invoiceId = invoice?.id as string | undefined;
  if (!invoiceId) return;

  const payment = await prisma.payment.findFirst({
    where: { xenditInvoiceId: invoiceId },
    include: { booking: true },
  });

  if (!payment || payment.status !== 'PENDING') return;

  // finalizePaidBooking marks the Payment COMPLETED, finalizes the booking,
  // nets any outstanding worker commission dues and schedules the payout.
  await finalizePaidBooking(
    payment.id,
    invoice.payment_id ?? null,
    invoice.paid_amount ?? null,
    invoice.paid_at ? new Date(invoice.paid_at) : null
  );

  void sendSmsToUser({
    userId: payment.booking.clientId,
    message: 'HomeEase: Your payment was received. Thank you!',
  });
}

async function handleInvoiceFailed(invoice: any) {
  const invoiceId = invoice?.id as string | undefined;
  if (!invoiceId) return;

  const payment = await prisma.payment.findFirst({
    where: { xenditInvoiceId: invoiceId, status: 'PENDING' },
    include: { booking: { select: { clientId: true } } },
  });
  if (!payment) return;

  // The booking stays in AWAITING_PAYMENT — the client can retry, which mints
  // a fresh invoice (createCompletionInvoice / resumeCompletionPayment).
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED', failureReason: invoice?.status ?? 'EXPIRED' },
  });

  await notifyUser({
    userId: payment.booking.clientId,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment Not Completed',
    message: 'Your payment did not go through. Open the booking to try again.',
    relatedId: payment.bookingId,
  });
}

/**
 * POST /api/payments/xendit/invoice-webhook
 * Handles Xendit's invoice status webhook (token-verified via
 * x-callback-token). Dispatches on the invoice's `status` field —
 * UNCONFIRMED whether Xendit wraps the invoice in an envelope (e.g.
 * { event, data }) or posts it flat; this defensively unwraps `body.data` if
 * present, else treats the body itself as the invoice. Confirm the real
 * shape against the Xendit dashboard's webhook logs/test tool or a live
 * payment and simplify this once verified.
 */
export const handleXenditInvoiceWebhook = async (req: Request, res: Response) => {
  try {
    const webhookToken = process.env.XENDIT_WEBHOOK_TOKEN;
    if (!webhookToken) {
      console.error('Xendit invoice webhook misconfigured: missing XENDIT_WEBHOOK_TOKEN');
      return res.status(500).json({ success: false, message: 'Webhook not configured' });
    }

    if (!verifyXenditCallbackToken(req.headers['x-callback-token'], webhookToken)) {
      await writeAuditLog({
        action: 'XENDIT_WEBHOOK_INVALID_TOKEN',
        category: 'SYSTEM_ERROR',
        level: 'WARN',
        message: 'Rejected Xendit invoice webhook: callback token mismatch',
      });
      return res.status(401).json({ success: false, message: 'Invalid callback token' });
    }

    const invoice = (req.body && typeof req.body === 'object' && 'data' in req.body ? (req.body as any).data : req.body) ?? {};
    const status = (invoice?.status as string | undefined)?.toUpperCase();

    switch (status) {
      case 'PAID':
        await handleInvoicePaid(invoice);
        break;
      case 'EXPIRED':
      case 'FAILED':
        await handleInvoiceFailed(invoice);
        break;
      default:
        break;
    }

    console.log('Xendit invoice webhook verified:', status);

    return res.status(200).json({
      success: true,
      message: 'Webhook received',
    });
  } catch (error) {
    console.error('Error handling Xendit invoice webhook:', error);
    await writeAuditLog({
      action: 'XENDIT_WEBHOOK_ERROR',
      category: 'SYSTEM_ERROR',
      level: 'ERROR',
      message: `Xendit invoice webhook handling failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return res.status(500).json({
      success: false,
      message: 'Failed to handle webhook',
    });
  }
};

/**
 * POST /api/payments/xendit/payout-webhook
 * Handles Xendit Payout status callbacks (token-verified via
 * x-callback-token). Looks up the Payout by Xendit's payout id, falling back
 * to reference_id (== Payout.id) in case the callback beats our own write of
 * xenditDisbursementId after createPayout() returns. Status vocabulary
 * UNCONFIRMED beyond ACCEPTED (the synchronous response, hand-validated) —
 * COMPLETED/FAILED assumed as the terminal webhook states; confirm against a
 * real payout webhook payload and adjust the branches below if it differs.
 */
export const handleXenditPayoutWebhook = async (req: Request, res: Response) => {
  try {
    const webhookToken = process.env.XENDIT_WEBHOOK_TOKEN;
    if (!webhookToken) {
      console.error('Xendit payout webhook misconfigured: missing XENDIT_WEBHOOK_TOKEN');
      return res.status(500).json({ success: false, message: 'Webhook not configured' });
    }

    if (!verifyXenditCallbackToken(req.headers['x-callback-token'], webhookToken)) {
      await writeAuditLog({
        action: 'XENDIT_PAYOUT_WEBHOOK_INVALID_TOKEN',
        category: 'SYSTEM_ERROR',
        level: 'WARN',
        message: 'Rejected Xendit payout webhook: callback token mismatch',
      });
      return res.status(401).json({ success: false, message: 'Invalid callback token' });
    }

    const resource = (req.body && typeof req.body === 'object' && 'data' in req.body ? (req.body as any).data : req.body) ?? {};
    const payoutId = resource?.id as string | undefined;
    const referenceId = resource?.reference_id as string | undefined;
    const status = (resource?.status as string | undefined)?.toUpperCase();
    const failureReason = resource?.failure_code ?? resource?.failure_reason;

    const found = payoutId
      ? await prisma.payout.findFirst({ where: { xenditDisbursementId: payoutId } })
      : null;
    const resolved = found ?? (referenceId ? await prisma.payout.findUnique({ where: { id: referenceId } }) : null);

    if (!resolved) {
      console.warn('Xendit payout webhook: no matching Payout for', { payoutId, referenceId });
      return res.status(200).json({ success: true, message: 'No matching payout' });
    }

    if (status === 'COMPLETED' || status === 'SUCCEEDED') {
      await prisma.payout.update({
        where: { id: resolved.id },
        data: {
          status: 'PAID',
          xenditStatus: status,
          xenditDisbursementId: payoutId ?? resolved.xenditDisbursementId,
          paidAt: new Date(),
        },
      });
      await notifyUser({
        userId: resolved.workerId,
        type: 'PAYOUT_SENT',
        title: 'Payout Sent',
        message: `₱${resolved.amount.toFixed(2)} has been sent to your ${resolved.channel} account`,
        relatedId: resolved.bookingId,
      });
      void sendSmsToUser({
        userId: resolved.workerId,
        message: `HomeEase: ₱${resolved.amount.toFixed(2)} has been sent to your ${resolved.channel} account.`,
      });
    } else if (status === 'FAILED') {
      await prisma.payout.update({
        where: { id: resolved.id },
        data: {
          status: 'FAILED',
          xenditStatus: status,
          xenditDisbursementId: payoutId ?? resolved.xenditDisbursementId,
          failureReason: failureReason ?? 'Xendit reported failure',
          failedAt: new Date(),
        },
      });
      await notifyUser({
        userId: resolved.workerId,
        type: 'PAYOUT_FAILED',
        title: 'Payout Failed',
        message: `We couldn't send your ₱${resolved.amount.toFixed(2)} payout. ${translateXenditFailureReason(failureReason)}`,
        relatedId: resolved.bookingId,
      });
      void sendSmsToUser({
        userId: resolved.workerId,
        message: `HomeEase: We couldn't send your ₱${resolved.amount.toFixed(2)} payout. ${translateXenditFailureReason(failureReason)}`,
      });
    }

    return res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('Error handling Xendit payout webhook:', error);
    await writeAuditLog({
      action: 'XENDIT_PAYOUT_WEBHOOK_ERROR',
      category: 'SYSTEM_ERROR',
      level: 'ERROR',
      message: `Xendit payout webhook handling failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return res.status(500).json({ success: false, message: 'Failed to handle webhook' });
  }
};