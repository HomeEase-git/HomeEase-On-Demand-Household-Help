import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import type { JwtPayload } from '@/types/index';
import { disputeInclude, formatDispute } from './adminDisputeController';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * GET /api/disputes/:id
 * Non-admin read path for a single Dispute — lets a client or worker check
 * on a dispute they're actually involved in. Until now Dispute could only be
 * read via the admin-only /api/admin/disputes/:id, so there was no way for
 * either party to see a dispute's status or an admin's resolution note.
 *
 * Authorization is checked against the caller's own userId (never a
 * client-supplied id): allowed only if they raised the dispute themselves,
 * or they're the client/worker on its associated booking. Everyone else
 * (including an unrelated client/worker) gets 403 — this is intentionally
 * not open to any authenticated user the way admin routes are.
 */
export const getDisputeForParty = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const id = req.params.id as string;
    const currentUserId = req.user.userId;

    const record = await prisma.dispute.findUnique({ where: { id }, include: disputeInclude });
    if (!record) {
      return res.status(404).json(errorResponse(404, 'Dispute not found'));
    }

    const isRaiser = record.raisedById === currentUserId;
    const isBookingParty =
      record.booking.clientId === currentUserId || record.booking.workerId === currentUserId;

    if (!isRaiser && !isBookingParty) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to view this dispute'));
    }

    return res.json({ success: true, data: formatDispute(record) });
  } catch (error) {
    console.error('Get dispute (party) error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
