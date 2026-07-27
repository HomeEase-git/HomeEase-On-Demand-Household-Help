import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';
import { getPriceBreakdown, calculateCommission, calculateWithholdingTax } from '../utils/pricing';
import { COMMISSION_RATE, WITHHOLDING_TAX_RATE } from '@config/pricing';

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
    } else {
      if (!rawMethodType) {
        return res.status(400).json(
          errorResponse(400, 'methodType is required and must be one of: GCASH, MAYA, CARD, BANK_TRANSFER, CASH')
        );
      }

      if (!validPaymentMethodTypes.includes(rawMethodType as (typeof validPaymentMethodTypes)[number])) {
        return res.status(400).json(
          errorResponse(400, `Invalid methodType "${rawMethodType}". Allowed values: GCASH, MAYA, CARD, BANK_TRANSFER, CASH`)
        );
      }

      methodType = rawMethodType as (typeof validPaymentMethodTypes)[number];
      accountIdentifier = requestAccountIdentifier || null;
    }

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

    // Can only create payment for completed or approved bookings
    if (!['COMPLETED', 'QUOTE_APPROVED'].includes(booking.status)) {
      return res.status(409).json(errorResponse(409, `Cannot create payment for booking with status ${booking.status}`));
    }

    // Check if payment already exists (bookingId is @unique on Payment)
    const existingPayment = await prisma.payment.findUnique({
      where: { bookingId },
    });

    if (existingPayment) {
      return res.status(409).json(errorResponse(409, 'Payment already exists for this booking'));
    }

    // Calculate amounts using inline quote fields and addOns
    const addonsCost = (booking.addOns || []).reduce((sum: number, addon: { price: number }) => sum + addon.price, 0);
    const hasQuote = booking.laborCost != null && booking.materialsCost != null;
    const subtotal = hasQuote
      ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0) + addonsCost
      : booking.estimatedPrice + addonsCost;
    const tip = booking.tip ?? 0;

    const commission = calculateCommission(subtotal);
    const withholdingTax = calculateWithholdingTax(subtotal);
    const workerPayout = subtotal - commission - withholdingTax + tip;
    const totalAmount = subtotal + tip;

    const payment = await prisma.payment.create({
      data: {
        bookingId,
        subtotal,
        tip,
        commissionRate: COMMISSION_RATE,
        commissionAmount: commission,
        withholdingTaxRate: WITHHOLDING_TAX_RATE,
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

    const breakdown = getPriceBreakdown(payment.subtotal, payment.tip, 0);

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
 * POST /api/payments/paymongo/intent
 * Create PayMongo payment intent
 * STUB for Sprint 3: will integrate with actual PayMongo API
 */
export const createPaymentIntent = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can create payments'));
    }

    const { bookingId, amount } = req.body;

    if (!bookingId || typeof bookingId !== 'string') {
      return res.status(400).json(errorResponse(400, 'bookingId is required'));
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json(errorResponse(400, 'amount must be a positive number'));
    }

    // TODO: Integrate with PayMongo API
    return res.status(200).json({
      success: true,
      message: 'Payment intent created (STUB)',
      data: {
        clientSecret: `pi_${Date.now()}_stub`,
        publishableKey: process.env.PAYMONGO_PUBLIC_KEY || 'pk_test_stub',
        amount,
        currency: 'PHP',
        description: `Payment for booking ${bookingId}`,
      },
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'PAYMENT_INTENT_ERROR',
      category: 'SYSTEM_ERROR',
      level: 'ERROR',
      message: `Payment intent creation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return res.status(500).json(errorResponse(500, 'Failed to create payment intent'));
  }
};

/**
 * POST /api/payments/paymongo/webhook
 * Handle PayMongo webhook events
 * STUB for Sprint 3
 */
export const handlePayMongoWebhook = async (req: Request, res: Response) => {
  try {
    const { type } = req.body; // `data` destructured but unused — removed to fix 6133

    // TODO: Validate webhook signature from PayMongo
    // TODO: Handle payment.succeeded, payment.failed events
    console.log('PayMongo webhook received (STUB):', type);

    return res.status(200).json({
      success: true,
      message: 'Webhook received (STUB)',
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