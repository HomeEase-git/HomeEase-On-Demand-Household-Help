import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';
import { calculateCommission, calculateWithholdingTax } from '../utils/pricing';
import { createInvoice } from '../services/xenditService';
import { getAppSettings } from '@services/appSettingsService';
import { translateXenditFailureReason } from '@utils/xenditFailureMessages';
import { handleWalletTopupPaid, handleWalletTopupFailed } from './walletController';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * POST /api/payments/:bookingId
 * Create Payment once booking is completed/approved
 *
 * Schema notes:
 *  - Payment has no clientId/workerId — ownership is accessed via booking relation
 *  - Payment.methodType is required (PaymentMethodType enum)
 *  - totalAmount is required on Payment
 *  - Booking quote data is inline (laborCost, materialsCost); addOns use `price` field
 */
export const createPayment = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const bookingId = req.params.bookingId as string;
    const currentUserId = req.user.userId;
    const validPaymentMethodTypes = ['GCASH', 'MAYA', 'CASH'] as const;
    const rawMethodType = typeof req.body?.methodType === 'string' ? req.body.methodType.trim() : '';
    const paymentMethodId = typeof req.body?.paymentMethodId === 'string' ? req.body.paymentMethodId.trim() : '';
    const requestAccountIdentifier = typeof req.body?.accountIdentifier === 'string' ? req.body.accountIdentifier.trim() : '';
    const xenditPaymentId = typeof req.body?.xenditPaymentId === 'string' ? req.body.xenditPaymentId.trim() : null;
    const xenditInvoiceId = typeof req.body?.xenditInvoiceId === 'string' ? req.body.xenditInvoiceId.trim() : null;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        addOns: true,   // schema: addOns (capital O), fields: name + price
        client: true,
        worker: true,
      },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    // Only client can create payment for their booking
    if (booking.clientId !== currentUserId) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to create payment for this booking'));
    }

    let methodType: (typeof validPaymentMethodTypes)[number] | null = null;
    let accountIdentifier: string | null = null;

    if (paymentMethodId) {
      const savedMethod = await prisma.savedPaymentMethod.findUnique({
        where: { id: paymentMethodId },
        include: { clientProfile: true },
      });

      if (!savedMethod) {
        return res.status(404).json(errorResponse(404, 'Payment method not found'));
      }

      if (savedMethod.clientProfile.userId !== currentUserId) {
        return res.status(403).json(errorResponse(403, 'Payment method does not belong to this user'));
      }

      methodType = savedMethod.type;
      accountIdentifier = savedMethod.accountIdentifier ?? (requestAccountIdentifier || null);

      if (rawMethodType && rawMethodType !== methodType) {
        return res.status(400).json(
          errorResponse(400, `Payment method type mismatch: expected ${savedMethod.type}, got ${rawMethodType}`)
        );
      }
    } else if (rawMethodType) {
      if (!validPaymentMethodTypes.includes(rawMethodType as (typeof validPaymentMethodTypes)[number])) {
        return res.status(400).json(
          errorResponse(400, `Invalid methodType "${rawMethodType}". Allowed values: GCASH, MAYA, CASH`)
        );
      }

      methodType = rawMethodType as (typeof validPaymentMethodTypes)[number];
      accountIdentifier = requestAccountIdentifier || null;
    } else if (booking.paymentMethodType) {
      // Nothing provided in the request — fall back to the method the client
      // already settled on when they made the booking.
      methodType = booking.paymentMethodType as (typeof validPaymentMethodTypes)[number];
      accountIdentifier = booking.paymentAccountIdentifier ?? (requestAccountIdentifier || null);
    } else {
      return res.status(400).json(
        errorResponse(400, 'methodType is required and must be one of: GCASH, MAYA, CASH')
      );
    }

    // Can only create payment for completed or approved bookings
    if (!['COMPLETED', 'QUOTE_APPROVED'].includes(booking.status)) {
      return res.status(409).json(errorResponse(409, `Cannot create payment for booking with status ${booking.status}`));
    }

    // Check if payment already exists (bookingId is @unique on Payment)
    const existingPayment = await prisma.payment.findUnique({
      where: { bookingId },
    });

    if (existingPayment) {
      if (existingPayment.status !== 'FAILED') {
        return res.status(409).json(errorResponse(409, 'Payment already exists for this booking'));
      }

      // A previous Xendit attempt failed (e.g. the client cancelled or the
      // e-wallet declined it) — clear it so the client can retry the payment.
      await prisma.payment.delete({ where: { id: existingPayment.id } });
    }

    // Calculate amounts using inline quote fields and addOns
    const addonsCost = (booking.addOns || []).reduce((sum: number, addon: { price: number }) => sum + addon.price, 0);
    const hasQuote = booking.laborCost != null && booking.materialsCost != null;
    const subtotal = hasQuote
      ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0) + addonsCost
      : booking.estimatedPrice + addonsCost;
    const tip = booking.tip ?? 0;

    const { commissionRate, withholdingTaxRate } = await getAppSettings();
    const commission = calculateCommission(subtotal, commissionRate);
    const withholdingTax = calculateWithholdingTax(subtotal, commissionRate, withholdingTaxRate);
    const workerPayout = subtotal - commission - withholdingTax + tip;
    const totalAmount = subtotal + tip;

    const payment = await prisma.payment.create({
      data: {
        bookingId,
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
        methodType: methodType as any,
        accountIdentifier,
        xenditPaymentId,
        xenditInvoiceId,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Payment created successfully',
      data: payment,
    });
  } catch (error) {
    console.error('Error creating payment:', error);
    return res.status(500).json(errorResponse(500, 'Failed to create payment'));
  }
};

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
 * POST /api/payments/:id/release
 * Release escrow: HELD → RELEASED
 */
export const releaseEscrow = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can release escrow'));
    }

    const id = req.params.id as string;
    const currentUserId = req.user.userId;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { booking: true },
    });

    if (!payment) {
      return res.status(404).json(errorResponse(404, 'Payment not found'));
    }

    // Ownership via booking (Payment has no clientId)
    if (payment.booking.clientId !== currentUserId) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to release this payment'));
    }

    if (payment.escrowStatus !== 'HELD') {
      return res.status(409).json(errorResponse(409, `Cannot release escrow with status ${payment.escrowStatus}`));
    }

    const updated = await prisma.payment.update({
      where: { id },
      data: {
        escrowStatus: 'RELEASED',
        releasedAt: new Date(),
        status: 'COMPLETED',
      },
    });

    // Notify worker — schema has PAYMENT_RECEIVED (no PAYMENT_RELEASED)
    // booking.workerId is nullable — skip if the booking has no assigned worker
    if (payment.booking.workerId) {
      await notifyUser({
        userId: payment.booking.workerId,
        type: 'PAYMENT_RECEIVED',
        title: 'Payment Released',
        message: `₱${payment.workerPayout} has been released to your account`,
        relatedId: payment.bookingId,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Escrow released successfully',
      data: {
        id: updated.id,
        escrowStatus: updated.escrowStatus,
        releasedAt: updated.releasedAt,
        workerPayout: updated.workerPayout,
      },
    });
  } catch (error) {
    console.error('Error releasing escrow:', error);
    return res.status(500).json(errorResponse(500, 'Failed to release escrow'));
  }
};

/**
 * POST /api/payments/:id/refund
 * Refund payment: escrow → REFUNDED
 */
export const refundPayment = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can request refunds'));
    }

    const id = req.params.id as string;
    const currentUserId = req.user.userId;
    const { reason } = req.body;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { booking: true },
    });

    if (!payment) {
      return res.status(404).json(errorResponse(404, 'Payment not found'));
    }

    // Ownership via booking
    if (payment.booking.clientId !== currentUserId) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to refund this payment'));
    }

    if (payment.escrowStatus !== 'HELD') {
      return res.status(409).json(errorResponse(409, `Cannot refund escrow with status ${payment.escrowStatus}`));
    }

    const updated = await prisma.payment.update({
      where: { id },
      data: {
        escrowStatus: 'REFUNDED',
        status: 'REFUNDED',
        refundReason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
        refundedAt: new Date(),
      },
    });

    // Notify worker (booking.workerId is nullable — skip if unassigned)
    if (payment.booking.workerId) {
      await notifyUser({
        userId: payment.booking.workerId,
        type: 'PAYMENT_REFUNDED',
        title: 'Payment Refunded',
        message: `Payment has been refunded: ${reason}`,
        relatedId: payment.bookingId,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Payment refunded successfully',
      data: {
        id: updated.id,
        escrowStatus: updated.escrowStatus,
        status: updated.status,
        refundedAt: updated.refundedAt,
        refundAmount: updated.subtotal,
      },
    });
  } catch (error) {
    console.error('Error refunding payment:', error);
    return res.status(500).json(errorResponse(500, 'Failed to refund payment'));
  }
};

/**
 * POST /api/payments/:bookingId/xendit/checkout
 * Create a Xendit Invoice for an already-created, still-PENDING Payment, and
 * return the hosted checkout URL for the mobile app to open in a WebView.
 * Unlike PayMongo's Source, a Xendit Invoice's hosted page supports every PH
 * payment channel (GCash, Maya, cards, GrabPay, etc) at once — methodType
 * here only gates when this flow is offered client-side, it isn't sent to
 * Xendit as a channel restriction. Capture is atomic on Xendit's side, so
 * there is no separate "charge" step; the invoice-paid webhook below is what
 * actually marks the Payment COMPLETED.
 */
export const createXenditCheckout = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can start a Xendit checkout'));
    }

    const bookingId = req.params.bookingId as string;
    const currentUserId = req.user.userId;

    const payment = await prisma.payment.findUnique({
      where: { bookingId },
      include: { booking: { include: { client: true } } },
    });

    if (!payment) {
      return res.status(404).json(errorResponse(404, 'Payment not found for this booking'));
    }

    if (payment.booking.clientId !== currentUserId) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to pay for this booking'));
    }

    if (payment.status !== 'PENDING') {
      return res.status(409).json(errorResponse(409, `Cannot start checkout for payment with status ${payment.status}`));
    }

    if (payment.methodType !== 'GCASH' && payment.methodType !== 'MAYA') {
      return res.status(400).json(errorResponse(400, 'Xendit checkout is only available for GCash and Maya'));
    }

    // Xendit's success_redirect_url/failure_redirect_url must be real http(s)
    // URLs, so this points at a placeholder domain that the mobile WebView
    // intercepts and cancels before it ever actually loads (see
    // XenditCheckoutModal.tsx).
    const redirectBase = process.env.XENDIT_REDIRECT_BASE_URL || 'https://homeease.app';

    const invoice = await createInvoice({
      externalId: payment.id,
      amountPesos: payment.totalAmount,
      description: `HomeEase booking ${bookingId}`,
      payerEmail: payment.booking.client.email ?? undefined,
      successRedirectUrl: `${redirectBase}/payment-redirect/success?bookingId=${bookingId}`,
      failureRedirectUrl: `${redirectBase}/payment-redirect/failed?bookingId=${bookingId}`,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { xenditInvoiceId: invoice.id },
    });

    return res.status(200).json({
      success: true,
      message: 'Xendit checkout created',
      data: {
        checkoutUrl: invoice.invoiceUrl,
        invoiceId: invoice.id,
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
 * Marks the Payment matching this Xendit invoice COMPLETED, but leaves
 * escrow HELD — same escrow semantics as before: charged != released. Money
 * still isn't released to the worker until the client confirms job
 * completion (see paymentLifecycleService.captureAndReleasePayment).
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

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      xenditPaymentId: invoice.payment_id ?? null,
      status: 'COMPLETED',
      capturedAmount: invoice.paid_amount ?? payment.totalAmount,
      capturedAt: invoice.paid_at ? new Date(invoice.paid_at) : new Date(),
    },
  });

  await notifyUser({
    userId: payment.booking.clientId,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment Confirmed',
    message: 'Your payment was received and is held until the job is completed.',
    relatedId: payment.bookingId,
  });
}

async function handleInvoiceFailed(invoice: any) {
  const invoiceId = invoice?.id as string | undefined;
  if (!invoiceId) return;

  await prisma.payment.updateMany({
    where: { xenditInvoiceId: invoiceId, status: 'PENDING' },
    data: { status: 'FAILED', failureReason: invoice?.status ?? 'EXPIRED' },
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
        await handleWalletTopupPaid(invoice);
        break;
      case 'EXPIRED':
      case 'FAILED':
        await handleInvoiceFailed(invoice);
        await handleWalletTopupFailed(invoice?.id, status);
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