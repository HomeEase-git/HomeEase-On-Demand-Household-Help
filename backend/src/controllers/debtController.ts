import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { adminAdjustDebt, releaseDebtHold } from '@services/debtLedgerService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * GET /api/admin/users/workers/:id/debt
 * A worker's outstanding platform dues + recent ledger history, for the
 * admin worker-detail screen.
 */
export const getWorkerDebtAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: id } });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const entries = await prisma.debtLedgerEntry.findMany({
      where: { workerProfileId: workerProfile.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.json({
      success: true,
      data: {
        commissionOwed: workerProfile.commissionOwed,
        debtHoldAt: workerProfile.debtHoldAt,
        debtHoldNote: workerProfile.debtHoldNote,
        entries: entries.map((e) => ({
          id: e.id,
          type: e.type,
          amount: e.amount,
          balanceAfter: e.balanceAfter,
          bookingId: e.bookingId,
          note: e.note,
          createdAt: e.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching worker debt:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch worker debt'));
  }
};

/**
 * PATCH /api/admin/users/workers/:id/debt/adjust
 * Manual correction with a required reason — for support cases (waiving
 * debt, correcting a bad accrual). `amount` is signed: positive reduces what
 * the worker owes, negative increases it.
 */
export const adjustWorkerDebtAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { amount, reason } = req.body as { amount?: number; reason?: string };

    if (typeof amount !== 'number' || amount === 0) {
      return res.status(400).json(errorResponse(400, 'amount must be a non-zero number'));
    }
    if (!reason?.trim()) {
      return res.status(400).json(errorResponse(400, 'reason is required'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: id } });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const { workerProfile: updated } = await adminAdjustDebt(workerProfile.id, amount, reason.trim());

    return res.json({ success: true, data: { commissionOwed: updated.commissionOwed } });
  } catch (error) {
    console.error('Error adjusting worker debt:', error);
    return res.status(500).json(errorResponse(500, 'Failed to adjust worker debt'));
  }
};

/**
 * PATCH /api/admin/users/workers/:id/debt/release
 * Lifts an account hold — the only way one is ever lifted (see
 * debtLedgerService.releaseDebtHold). `note` is optional but recommended
 * (what was agreed with the worker).
 */
export const releaseWorkerHold = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { note } = req.body as { note?: string };

    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: id } });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }
    if (!workerProfile.debtHoldAt) {
      return res.status(409).json(errorResponse(409, 'Worker is not currently on hold'));
    }

    const updated = await releaseDebtHold(workerProfile.id, note?.trim());

    return res.json({ success: true, data: { debtHoldAt: updated.debtHoldAt } });
  } catch (error) {
    console.error('Error releasing worker hold:', error);
    return res.status(500).json(errorResponse(500, 'Failed to release worker hold'));
  }
};
