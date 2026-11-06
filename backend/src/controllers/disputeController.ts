import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import type { JwtPayload } from '@/types/index';
import { disputeInclude, formatDispute } from './adminDisputeController';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

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
