import { Request, Response } from 'express';
import type { RefundRequestStatus } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatDisplayId } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import {
  approveRefundRequest,
  rejectRefundRequest,
  markRefundedManually,
  RefundRequestError,
} from '@services/refundRequestService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const STATUSES: RefundRequestStatus[] = ['PENDING', 'APPROVED', 'FAILED', 'REJECTED', 'REFUNDED_MANUALLY'];

/**
 * GET /api/admin/payments/refund-requests?status=PENDING,FAILED
 * The refund approval queue. `status` takes one or more comma-separated
 * RefundRequestStatus values; omitted = all.
 */
export const listRefundRequests = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const requested = typeof req.query.status === 'string' ? req.query.status.split(',') : [];
    const statuses = requested.map((s) => s.trim().toUpperCase()).filter((s): s is RefundRequestStatus =>
      STATUSES.includes(s as RefundRequestStatus)
    );
    const where = statuses.length ? { status: { in: statuses } } : {};

    const [total, records, awaiting] = await Promise.all([
      prisma.refundRequest.count({ where }),
      prisma.refundRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { payment: { select: { methodType: true, payout: { select: { status: true } } } } },
      }),
      prisma.refundRequest.count({ where: { status: { in: ['PENDING', 'FAILED'] } } }),
    ]);

    const bookings = await prisma.booking.findMany({
      where: { id: { in: records.map((r) => r.bookingId) } },
      select: { id: true, client: { select: { fullName: true } }, worker: { select: { fullName: true } } },
    });
    const byId = new Map(bookings.map((b) => [b.id, b]));

    return res.json({
      success: true,
      data: records.map((r) => ({
        id: r.id,
        bookingId: r.bookingId,
        booking: formatDisplayId(r.bookingId),
        client: byId.get(r.bookingId)?.client?.fullName ?? '—',
        worker: byId.get(r.bookingId)?.worker?.fullName ?? '—',
        amount: r.amount,
        method: r.payment.methodType,
        payoutStatus: r.payment.payout?.status ?? null,
        reason: r.reason,
        source: r.source,
        status: r.status,
        disputeId: r.disputeId,
        decisionNote: r.decisionNote,
        failureReason: r.failureReason,
        decidedAt: r.decidedAt,
        createdAt: r.createdAt,
      })),
      meta: { ...buildPaginationMeta(total, page, limit), awaitingDecision: awaiting },
    });
  } catch (error) {
    console.error('List refund requests error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

function decide(action: 'approve' | 'reject' | 'manual') {
  return async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const adminId = req.user?.userId as string;
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      if (action !== 'approve' && !note) {
        return res.status(400).json(errorResponse(400, 'A note is required'));
      }

      const result =
        action === 'approve'
          ? await approveRefundRequest(id, adminId, note || null)
          : action === 'reject'
            ? await rejectRefundRequest(id, adminId, note)
            : await markRefundedManually(id, adminId, note);

      return res.json({ success: true, data: { id: result.id, status: result.status, failureReason: result.failureReason } });
    } catch (error) {
      if (error instanceof RefundRequestError) {
        return res.status(error.statusCode).json(errorResponse(error.statusCode, error.message));
      }
      console.error(`Refund request ${action} error:`, error);
      return res.status(500).json(errorResponse(500, 'Internal server error'));
    }
  };
}

/** POST /api/admin/payments/refund-requests/:id/approve — sends the refund. */
export const approveRefund = decide('approve');
/** POST /api/admin/payments/refund-requests/:id/reject — note required. */
export const rejectRefund = decide('reject');
/** POST /api/admin/payments/refund-requests/:id/manual — settled outside the app; note required. */
export const markRefundManual = decide('manual');
