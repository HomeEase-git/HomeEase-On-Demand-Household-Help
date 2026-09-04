import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import { formatDisplayId, formatPeso } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { refundOrVoidPayment } from '@services/paymentLifecycleService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const RESOLVE_ACTIONS = ['APPROVE_QUOTE', 'REQUEST_NEW_QUOTE', 'CANCEL_BOOKING'] as const;
type ResolveAction = (typeof RESOLVE_ACTIONS)[number];

const RESOLVED_STATUS_BY_ACTION: Record<ResolveAction, string> = {
  APPROVE_QUOTE: 'RESOLVED_APPROVED',
  REQUEST_NEW_QUOTE: 'RESOLVED_NEW_QUOTE_REQUESTED',
  CANCEL_BOOKING: 'RESOLVED_CANCELLED',
};

const disputeInclude = {
  booking: {
    include: {
      client: { select: { id: true, fullName: true } },
      worker: { select: { id: true, fullName: true } },
      payment: { select: { id: true, status: true, escrowStatus: true } },
    },
  },
} satisfies Prisma.DisputeInclude;

type DisputeRecord = Prisma.DisputeGetPayload<{ include: typeof disputeInclude }>;

function formatDispute(record: DisputeRecord) {
  const booking = record.booking;
  const amount = booking.finalPrice ?? booking.estimatedPrice ?? null;

  return {
    id: record.id,
    bookingId: booking.id,
    displayId: formatDisplayId(booking.id),
    client: booking.client?.fullName ?? '—',
    clientId: booking.client?.id ?? null,
    worker: booking.worker?.fullName ?? '—',
    workerId: booking.worker?.id ?? null,
    amount: amount != null ? formatPeso(amount) : '—',
    reason: record.reason,
    status: record.status,
    resolution: record.resolution,
    resolvedById: record.resolvedById,
    resolvedAt: record.resolvedAt,
    createdAt: record.createdAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}

function buildDisputeWhere(search: string, status: string): Prisma.DisputeWhereInput {
  const where: Prisma.DisputeWhereInput = {};

  if (status && status !== 'all') {
    where.status = status.toUpperCase();
  }

  if (search) {
    where.OR = [
      { bookingId: { contains: search } },
      { reason: { contains: search } },
      { booking: { client: { fullName: { contains: search } } } },
      { booking: { worker: { fullName: { contains: search } } } },
    ];
  }

  return where;
}

/**
 * GET /api/admin/disputes?status=OPEN|UNDER_REVIEW|RESOLVED_*|REJECTED|all
 */
export const listDisputes = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';

    const where = buildDisputeWhere(search, status);

    const [total, records] = await Promise.all([
      prisma.dispute.count({ where }),
      prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: disputeInclude,
      }),
    ]);

    return res.json({
      success: true,
      data: records.map(formatDispute),
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('List disputes error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getDisputeById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const record = await prisma.dispute.findUnique({ where: { id }, include: disputeInclude });
    if (!record) {
      return res.status(404).json(errorResponse(404, 'Dispute not found'));
    }

    return res.json({ success: true, data: formatDispute(record) });
  } catch (error) {
    console.error('Get dispute error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/**
 * PATCH /api/admin/disputes/:id/resolve
 * Body: { action: 'APPROVE_QUOTE' | 'REQUEST_NEW_QUOTE' | 'CANCEL_BOOKING', resolution?: string }
 *
 *  - APPROVE_QUOTE: proceeds the booking to QUOTE_APPROVED (final price =
 *    laborCost + materialsCost) and re-affirms the payment hold — the actual
 *    capture still happens at confirm-completion, matching the normal
 *    non-disputed quote-approval flow.
 *  - REQUEST_NEW_QUOTE: resets quoteStatus to PENDING and sends the booking
 *    back to IN_PROGRESS so the worker can resubmit via POST .../quote.
 *  - CANCEL_BOOKING: cancels the booking, writes a Cancellation record, and
 *    releases/refunds the held escrow.
 */
export const resolveDispute = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { action, resolution } = req.body as { action?: string; resolution?: string };
    const adminId = req.user?.userId;

    if (!action || !RESOLVE_ACTIONS.includes(action as ResolveAction)) {
      return res.status(400).json(errorResponse(400, `action must be one of: ${RESOLVE_ACTIONS.join(', ')}`));
    }

    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: { booking: true },
    });

    if (!dispute) {
      return res.status(404).json(errorResponse(404, 'Dispute not found'));
    }

    if (dispute.status !== 'OPEN' && dispute.status !== 'UNDER_REVIEW') {
      return res.status(409).json(errorResponse(409, `Dispute already resolved (${dispute.status})`));
    }

    const booking = dispute.booking;
    // Quote actions only make sense on a quote dispute; CANCEL_BOOKING can also
    // resolve a payment-overdue or refund-request dispute (booking still in
    // PENDING_COMPLETION / AWAITING_PAYMENT / COMPLETED).
    if (action !== 'CANCEL_BOOKING' && booking.status !== 'DISPUTED') {
      return res.status(409).json(errorResponse(409, 'Booking is not currently disputed'));
    }
    if (
      action === 'CANCEL_BOOKING' &&
      !['DISPUTED', 'PENDING_COMPLETION', 'AWAITING_PAYMENT', 'COMPLETED'].includes(booking.status)
    ) {
      return res.status(409).json(errorResponse(409, `Cannot resolve — booking is ${booking.status}`));
    }

    const resolvedStatus = RESOLVED_STATUS_BY_ACTION[action as ResolveAction];
    // A COMPLETED booking stays COMPLETED — we refund without un-completing it.
    const cancelKeepsStatus = action === 'CANCEL_BOOKING' && booking.status === 'COMPLETED';

    await prisma.$transaction(async (tx) => {
      if (action === 'APPROVE_QUOTE') {
        if (booking.laborCost == null || booking.materialsCost == null) {
          throw new Error('NO_QUOTE');
        }
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'QUOTE_APPROVED',
            quoteStatus: 'APPROVED',
            approvedAt: new Date(),
            finalPrice: booking.laborCost + booking.materialsCost,
            disputeResolvedById: adminId,
            disputeResolvedAt: new Date(),
          },
        });
      } else if (action === 'REQUEST_NEW_QUOTE') {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'IN_PROGRESS',
            quoteStatus: 'PENDING',
            laborCost: null,
            materialsCost: null,
            quoteNotes: null,
            quotedAt: null,
            disputeResolvedById: adminId,
            disputeResolvedAt: new Date(),
          },
        });
      } else {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            ...(cancelKeepsStatus ? {} : { status: 'CANCELLED' }),
            disputeResolvedById: adminId,
            disputeResolvedAt: new Date(),
          },
        });
        if (!cancelKeepsStatus) {
          await tx.cancellation.create({
            data: {
              bookingId: booking.id,
              cancelledBy: 'ADMIN',
              cancelledById: adminId ?? 'system',
              reason: resolution?.trim() || 'Cancelled via dispute resolution',
            },
          });
        }
      }

      await tx.dispute.update({
        where: { id },
        data: {
          status: resolvedStatus,
          resolution: resolution?.trim() || null,
          resolvedById: adminId,
          resolvedAt: new Date(),
        },
      });
    });

    if (action === 'CANCEL_BOOKING') {
      await refundOrVoidPayment(booking.id, resolution?.trim() || 'Cancelled via dispute resolution').catch((error) => {
        console.error(`Failed to refund payment for dispute-cancelled booking ${booking.id}:`, error);
      });
    }

    await writeAuditLog({
      actorId: adminId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'DISPUTE_RESOLVED',
      category: 'ADMIN_ACTION',
      message: `Dispute for booking ${formatDisplayId(booking.id)} resolved via ${action}`,
    });

    const partiesToNotify = [booking.clientId, booking.workerId].filter((v): v is string => Boolean(v));
    await Promise.all(
      partiesToNotify.map((userId) =>
        notifyUser({
          userId,
          type: 'QUOTE_DISPUTED',
          title: 'Dispute Resolved',
          message: `Your dispute for booking ${formatDisplayId(booking.id)} was resolved: ${action.replace(/_/g, ' ').toLowerCase()}`,
          relatedId: booking.id,
        })
      )
    );

    const updated = await prisma.dispute.findUniqueOrThrow({ where: { id }, include: disputeInclude });
    return res.json({ success: true, data: formatDispute(updated) });
  } catch (error: any) {
    if (error.message === 'NO_QUOTE') {
      return res.status(400).json(errorResponse(400, 'No quote exists on this booking to approve'));
    }
    console.error('Resolve dispute error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
