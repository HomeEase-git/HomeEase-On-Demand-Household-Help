import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * GET /api/blocks
 * The users the caller has blocked, newest first.
 */
export const listBlocks = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: req.user.userId },
      include: { blocked: { select: { id: true, fullName: true, avatar: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return res.status(200).json({
      success: true,
      message: 'Blocked users retrieved',
      data: {
        blocks: rows.map((r) => ({
          userId: r.blocked.id,
          name: r.blocked.fullName,
          avatar: r.blocked.avatar,
          blockedAt: r.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Error listing blocks:', error);
    return res.status(500).json(errorResponse(500, 'Failed to list blocked users'));
  }
};

/**
 * POST /api/blocks/:userId
 * Block a user. Repeating it is a no-op.
 */
export const blockUser = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const blockerId = req.user.userId;
    const blockedId = req.params.userId as string;
    if (blockedId === blockerId) {
      return res.status(400).json(errorResponse(400, "You can't block yourself"));
    }
    const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!target) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }
    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    return res.status(200).json({ success: true, message: 'User blocked', data: { userId: blockedId } });
  } catch (error) {
    console.error('Error blocking user:', error);
    return res.status(500).json(errorResponse(500, 'Failed to block user'));
  }
};

/**
 * DELETE /api/blocks/:userId
 */
export const unblockUser = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const blockedId = req.params.userId as string;
    await prisma.userBlock.deleteMany({ where: { blockerId: req.user.userId, blockedId } });
    return res.status(200).json({ success: true, message: 'User unblocked', data: { userId: blockedId } });
  } catch (error) {
    console.error('Error unblocking user:', error);
    return res.status(500).json(errorResponse(500, 'Failed to unblock user'));
  }
};
