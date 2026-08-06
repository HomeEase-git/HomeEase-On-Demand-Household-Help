import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';
import { calculateCommission, calculateWithholdingTax } from '../utils/pricing';
import { createSource, createSourcePayment } from '../services/paymongoService';
import { getAppSettings } from '@services/appSettingsService';

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
    const validPaymentMethodTypes = ['GCASH', 'MAYA', 'CARD', 'BANK_TRANSFER', 'CASH'] as const;
    const rawMethodType = typeof req.body?.methodType === 'string' ? req.body.methodType.trim() : '';
    const paymentMethodId = typeof req.body?.paymentMethodId === 'string' ? req.body.paymentMethodId.trim() : '';
    const requestAccountIdentifier = typeof req.body?.accountIdentifier === 'string' ? req.body.accountIdentifier.trim() : '';
    const paymongoPaymentId = typeof req.body?.paymongoPaymentId === 'string' ? req.body.paymongoPaymentId.trim() : null;
    const paymongoSourceId = typeof req.body?.paymongoSourceId === 'string' ? req.body.paymongoSourceId.trim() : null;

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
          errorResponse(400, `Invalid methodType "${rawMethodType}". Allowed values: GCASH, MAYA, CARD, BANK_TRANSFER, CASH`)
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
        errorResponse(400, 'methodType is required and must be one of: GCASH, MAYA, CARD, BANK_TRANSFER, CASH')
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

      // A previous PayMongo attempt failed (e.g. the client cancelled or the
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
        paymongoPaymentId,
        paymongoSourceId,
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
        // schema has paymongoPaymentId, not paymentMethodReference
        transactionId: payment.paymongoPaymentId ?? null,
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
 * POST /api/payments/:bookingId/paymongo/checkout
 * Create a real PayMongo Source (GCash/Maya) for an already-created, still-PENDING
 * Payment, and return the hosted checkout URL for the mobile app to open in a
 * WebView. The actual charge happens later, server-side, once the webhook
 * reports the source as chargeable (see handlePayMongoWebhook below).
 */
export const createPaymongoCheckout = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can start a PayMongo checkout'));
    }

    const bookingId = req.params.bookingId as string;
    const currentUserId = req.user.userId;

    const payment = await prisma.payment.findUnique({
      where: { bookingId },
      include: { booking: true },
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
      return res.status(400).json(errorResponse(400, 'PayMongo checkout is only available for GCash and Maya'));
    }

    // PayMongo rejects non-http(s) redirect URLs, so this points at a
    // placeholder domain that the mobile WebView intercepts and cancels
    // before it ever actually loads (see PaymongoCheckoutModal.tsx).
    const redirectBase = process.env.PAYMONGO_REDIRECT_BASE_URL || 'https://homeease.app';

    const source = await createSource({
      amountPesos: payment.totalAmount,
      type: payment.methodType === 'GCASH' ? 'gcash' : 'paymaya',
      description: `HomeEase booking ${bookingId}`,
      successRedirect: `${redirectBase}/payment-redirect/success?bookingId=${bookingId}`,
      failedRedirect: `${redirectBase}/payment-redirect/failed?bookingId=${bookingId}`,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { paymongoSourceId: source.id },
    });

    return res.status(200).json({
      success: true,
      message: 'PayMongo checkout created',
      data: {
        checkoutUrl: source.checkoutUrl,
        sourceId: source.id,
      },
    });
  } catch (error) {
    console.error('Error creating PayMongo checkout:', error);
    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'PAYMONGO_CHECKOUT_ERROR',
      category: 'SYSTEM_ERROR',
      level: 'ERROR',
      message: `PayMongo checkout creation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return res.status(500).json(errorResponse(500, 'Failed to create PayMongo checkout'));
  }
};

/**
 * Verifies a PayMongo `Paymongo-Signature` header against the raw request body.
 *
 * Header format: `t=<timestamp>,te=<test-mode hmac>,li=<live-mode hmac>`.
 * PayMongo signs `${timestamp}.${rawBody}` with HMAC-SHA256 using the webhook's
 * signing secret; only one of te/li will match depending on whether the secret
 * configured here is the test-mode or live-mode secret for that endpoint.
 */
function verifyPaymongoSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key?.trim(), value?.trim()];
    })
  );

  const timestamp = parts.t;
  const candidateSignatures = [parts.te, parts.li].filter(Boolean) as string[];

  if (!timestamp || candidateSignatures.length === 0) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'utf8');

  return candidateSignatures.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    return (
      candidateBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  });
}

/**
 * Charges a chargeable e-wallet Source and marks the corresponding Payment
 * COMPLETED, but leaves escrow HELD. Payment rows are now created (and this
 * checkout started) at booking-creation time, well before the job is done —
 * GCash/Maya have no manual-capture primitive, so "capture" for these
 * methods just means the charge succeeded; the money still isn't released
 * to the worker until the client confirms completion (see
 * paymentLifecycleService.captureAndReleasePayment), same as the CARD and
 * cash/bank paths.
 */
async function handleSourceChargeable(sourceId: string | undefined) {
  if (!sourceId) return;

  const payment = await prisma.payment.findFirst({
    where: { paymongoSourceId: sourceId },
    include: { booking: true },
  });

  if (!payment || payment.status !== 'PENDING') return;

  try {
    const created = await createSourcePayment({
      amountPesos: payment.totalAmount,
      sourceId,
      description: `HomeEase booking ${payment.bookingId}`,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        paymongoPaymentId: created.id,
        status: 'COMPLETED',
        capturedAmount: payment.totalAmount,
        capturedAt: new Date(),
      },
    });

    await notifyUser({
      userId: payment.booking.clientId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment Confirmed',
      message: 'Your payment was received and is held until the job is completed.',
      relatedId: payment.bookingId,
    });
  } catch (chargeError) {
    console.error('Failed to charge chargeable PayMongo source:', chargeError);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED' },
    });
  }
}

async function handlePaymentFailed(sourceId: string | undefined) {
  if (!sourceId) return;

  await prisma.payment.updateMany({
    where: { paymongoSourceId: sourceId, status: 'PENDING' },
    data: { status: 'FAILED' },
  });
}

/**
 * POST /api/payments/paymongo/webhook
 * Handle PayMongo webhook events (signature-verified).
 *
 * `source.chargeable` is the authoritative trigger for e-wallet payments —
 * PayMongo fires it (and separately redirects the client's WebView) once the
 * user authorizes the GCash/Maya charge; this handler is what actually
 * captures the money via createSourcePayment. `payment.failed` covers the
 * decline/cancel path.
 */
export const handlePayMongoWebhook = async (req: Request, res: Response) => {
  try {
    const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
    const rawBody = req.body;

    if (!webhookSecret || !Buffer.isBuffer(rawBody)) {
      console.error('PayMongo webhook misconfigured: missing PAYMONGO_WEBHOOK_SECRET or raw body middleware');
      return res.status(500).json({ success: false, message: 'Webhook not configured' });
    }

    const signatureHeader = req.headers['paymongo-signature'] as string | undefined;

    if (!verifyPaymongoSignature(rawBody, signatureHeader, webhookSecret)) {
      await writeAuditLog({
        action: 'PAYMONGO_WEBHOOK_INVALID_SIGNATURE',
        category: 'SYSTEM_ERROR',
        level: 'WARN',
        message: 'Rejected PayMongo webhook: signature verification failed',
      });
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const type = event?.data?.attributes?.type;
    const resource = event?.data?.attributes?.data;

    switch (type) {
      case 'source.chargeable':
        await handleSourceChargeable(resource?.id);
        break;
      case 'payment.failed':
        await handlePaymentFailed(resource?.attributes?.source?.id);
        break;
      default:
        break;
    }

    console.log('PayMongo webhook verified:', type);

    return res.status(200).json({
      success: true,
      message: 'Webhook received',
    });
  } catch (error) {
    console.error('Error handling webhook:', error);
    await writeAuditLog({
      action: 'PAYMONGO_WEBHOOK_ERROR',
      category: 'SYSTEM_ERROR',
      level: 'ERROR',
      message: `PayMongo webhook handling failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return res.status(500).json({
      success: false,
      message: 'Failed to handle webhook',
    });
  }
};

/**
 * POST /api/payments/paymongo/transfers/callback
 * Handles PayMongo transfer (disbursement) status callbacks. The
 * `callback_url` submitted with each transfer is assumed to be signed the
 * same way as the collections webhook (`Paymongo-Signature` HMAC over the
 * raw body, using PAYMONGO_WEBHOOK_SECRET) — PayMongo's docs don't spell
 * this out explicitly for transfers, so confirm against a real payload once
 * the Wallet/Disbursements product is enabled and adjust here if it differs.
 * Looks up the Payout by PayMongo's transfer id, falling back to
 * reference_number (== Payout.id) in case the callback beats our own write
 * of paymongoTransferId after createTransfer() returns.
 */
export const handlePaymongoTransferWebhook = async (req: Request, res: Response) => {
  try {
    const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
    const rawBody = req.body;

    if (!webhookSecret || !Buffer.isBuffer(rawBody)) {
      console.error('PayMongo transfer webhook misconfigured: missing PAYMONGO_WEBHOOK_SECRET or raw body middleware');
      return res.status(500).json({ success: false, message: 'Webhook not configured' });
    }

    const signatureHeader = req.headers['paymongo-signature'] as string | undefined;

    if (!verifyPaymongoSignature(rawBody, signatureHeader, webhookSecret)) {
      await writeAuditLog({
        action: 'PAYMONGO_TRANSFER_WEBHOOK_INVALID_SIGNATURE',
        category: 'SYSTEM_ERROR',
        level: 'WARN',
        message: 'Rejected PayMongo transfer webhook: signature verification failed',
      });
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    // The transfer callback payload shape isn't fully documented — defensively
    // accept either a bare transfer object or one wrapped in data/data.attributes,
    // mirroring the collections webhook's envelope.
    const resource = event?.data?.attributes ?? event?.data ?? event;
    const transferId = resource?.id as string | undefined;
    const referenceNumber = resource?.reference_number as string | undefined;
    const status = (resource?.status as string | undefined)?.toLowerCase();
    const failureReason = resource?.failure_reason as string | undefined;

    const payout = transferId
      ? await prisma.payout.findFirst({ where: { paymongoTransferId: transferId } })
      : null;
    const resolved = payout ?? (referenceNumber ? await prisma.payout.findUnique({ where: { id: referenceNumber } }) : null);

    if (!resolved) {
      console.warn('PayMongo transfer webhook: no matching Payout for', { transferId, referenceNumber });
      return res.status(200).json({ success: true, message: 'No matching payout' });
    }

    if (status === 'succeeded') {
      await prisma.payout.update({
        where: { id: resolved.id },
        data: {
          status: 'PAID',
          paymongoTransferStatus: status,
          paymongoTransferId: transferId ?? resolved.paymongoTransferId,
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
    } else if (status === 'failed') {
      await prisma.payout.update({
        where: { id: resolved.id },
        data: {
          status: 'FAILED',
          paymongoTransferStatus: status,
          paymongoTransferId: transferId ?? resolved.paymongoTransferId,
          failureReason: failureReason ?? 'PayMongo reported failure',
          failedAt: new Date(),
        },
      });
      await notifyUser({
        userId: resolved.workerId,
        type: 'PAYOUT_FAILED',
        title: 'Payout Failed',
        message: `We couldn't send your ₱${resolved.amount.toFixed(2)} payout. Our team has been notified.`,
        relatedId: resolved.bookingId,
      });
    }

    return res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('Error handling PayMongo transfer webhook:', error);
    await writeAuditLog({
      action: 'PAYMONGO_TRANSFER_WEBHOOK_ERROR',
      category: 'SYSTEM_ERROR',
      level: 'ERROR',
      message: `PayMongo transfer webhook handling failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return res.status(500).json({ success: false, message: 'Failed to handle webhook' });
  }
};