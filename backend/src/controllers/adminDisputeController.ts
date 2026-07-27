import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { formatDisplayId, formatPeso } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// The schema has no standalone Dispute model — a "dispute" is a Booking whose
// status has transitioned to DISPUTED (see bookingController.disputeQuote).
// Resolving one either moves the booking to one of the states reachable from
// DISPUTED, or — for the "REFUNDED" action the web admin's Refunds page uses —
// refunds the linked Payment's escrow (mirrors paymentController.refundPayment)
// and closes the booking out as CANCELLED.
const DIRECT_TRANSITIONS = ['QUOTE_APPROVED', 'QUOTE_SUBMITTED', 'CANCELLED'] as const;

const disputeInclude = {
  client: { select: { id: true, fullName: true } },
  worker: { select: { id: true, fullName: true } },
  payment: { select: { id: true, status: true, escrowStatus: true } },
} satisfies Prisma.BookingInclude;

type DisputeRecord = Prisma.BookingGetPayload<{ include: typeof disputeInclude }>;

function formatDispute(record: DisputeRecord) {
  const amount = record.finalPrice ?? record.estimatedPrice ?? null;

  return {
    id: record.id,
    displayId: formatDisplayId(record.id),
    bookingId: record.id,
    client: record.client?.fullName ?? '—',
    clientId: record.client?.id ?? null,
    worker: record.worker?.fullName ?? '—',
    workerId: record.worker?.id ?? null,
    amount: amount != null ? formatPeso(amount) : '—',
    reason: record.disputeReason,
    status: record.payment?.status === 'REFUNDED' ? 'REFUNDED' : record.status,
    resolvedById: record.disputeResolvedById,
    resolvedAt: record.disputeResolvedAt,
    createdAt: record.createdAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}

function buildDisputeWhere(search: string): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = { status: 'DISPUTED' };

  if (search) {
    where.OR = [
      { id: { contains: search } },
      { client: { fullName: { contains: search } } },
      { worker: { fullName: { contains: search } } },
      { disputeReason: { contains: search } },
    ];
  }

  return where;
}

export const listDisputes = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const where = buildDisputeWhere(search);

    const [total, records] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
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

export const updateDispute = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status, resolution } = req.body as { status?: string; resolution?: string };
    const adminId = req.user?.userId;

    const targetStatus = status?.toUpperCase();
    const isRefund = targetStatus === 'REFUNDED';
    const isDirectTransition = DIRECT_TRANSITIONS.includes(
      targetStatus as (typeof DIRECT_TRANSITIONS)[number]
    );

    if (!targetStatus || !(isRefund || isDirectTransition)) {
      return res
        .status(400)
        .json(errorResponse(400, `status must be one of: REFUNDED, ${DIRECT_TRANSITIONS.join(', ')}`));
    }

    const booking = await prisma.booking.findUnique({ where: { id }, include: { payment: true } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Dispute not found'));
    }

    if (booking.status !== 'DISPUTED') {
      return res.status(409).json(errorResponse(409, 'Booking is not currently disputed'));
    }

    const noteSuffix = resolution?.trim() ? `\n[Admin resolution] ${resolution.trim()}` : '';
    const disputeReason = `${booking.disputeReason ?? ''}${noteSuffix}`.trim() || booking.disputeReason;

    if (isRefund) {
      if (!booking.payment) {
        return res.status(400).json(errorResponse(400, 'No payment found to refund for this booking'));
      }

      if (booking.payment.escrowStatus !== 'HELD') {
        return res
          .status(409)
          .json(errorResponse(409, `Cannot refund escrow with status ${booking.payment.escrowStatus}`));
      }

      const [, updatedBooking] = await prisma.$transaction([
        prisma.payment.update({
          where: { id: booking.payment.id },
          data: {
            status: 'REFUNDED',
            escrowStatus: 'REFUNDED',
            refundReason: resolution?.trim() || 'Refunded via admin dispute resolution',
            refundedAt: new Date(),
          },
        }),
        prisma.booking.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            disputeReason,
            disputeResolvedById: adminId,
            disputeResolvedAt: new Date(),
          },
          include: disputeInclude,
        }),
      ]);

      await writeAuditLog({
        actorId: adminId,
        actorName: req.user?.email,
        actorRole: req.user?.role,
        action: 'DISPUTE_RESOLVED',
        category: 'ADMIN_ACTION',
        message: `Dispute for booking ${formatDisplayId(id)} resolved via REFUNDED`,
      });

      return res.json({ success: true, data: formatDispute(updatedBooking) });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: targetStatus as Prisma.BookingUpdateInput['status'],
        disputeReason,
        disputeResolvedById: adminId,
        disputeResolvedAt: new Date(),
      },
      include: disputeInclude,
    });

    await writeAuditLog({
      actorId: adminId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'DISPUTE_RESOLVED',
      category: 'ADMIN_ACTION',
      message: `Dispute for booking ${formatDisplayId(id)} resolved via ${targetStatus}`,
    });

    return res.json({ success: true, data: formatDispute(updated) });
  } catch (error) {
    console.error('Update dispute error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
