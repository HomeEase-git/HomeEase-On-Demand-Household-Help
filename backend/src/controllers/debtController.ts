import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import { adminAdjustDebt, releaseDebtHold, DuesAdjustmentError } from '@services/debtLedgerService';
import { postClientFeeCleared } from '@services/ledgerService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

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
        compensationCredit: workerProfile.compensationCredit,
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

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'WORKER_DEBT_ADJUSTED',
      category: 'ADMIN_ACTION',
      message: `Adjusted worker ${id}'s commission owed by ${amount > 0 ? '-' : '+'}₱${Math.abs(amount).toFixed(2)}: ${reason.trim()}`,
      metadata: { workerId: id, amount, commissionOwedAfter: updated.commissionOwed },
    });

    return res.json({ success: true, data: { commissionOwed: updated.commissionOwed } });
  } catch (error) {
    if (error instanceof DuesAdjustmentError) {
      return res.status(400).json(errorResponse(400, error.message));
    }
    console.error('Error adjusting worker debt:', error);
    return res.status(500).json(errorResponse(500, 'Failed to adjust worker debt'));
  }
};

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

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'WORKER_DEBT_HOLD_RELEASED',
      category: 'ADMIN_ACTION',
      message: `Released debt hold for worker ${id}${note?.trim() ? `: ${note.trim()}` : ''}`,
      metadata: { workerId: id },
    });

    return res.json({ success: true, data: { debtHoldAt: updated.debtHoldAt } });
  } catch (error) {
    console.error('Error releasing worker hold:', error);
    return res.status(500).json(errorResponse(500, 'Failed to release worker hold'));
  }
};

export const getClientPaymentHoldAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const clientProfile = await prisma.clientProfile.findUnique({ where: { userId: id } });
    if (!clientProfile) {
      return res.status(404).json(errorResponse(404, 'Client not found'));
    }

    return res.json({
      success: true,
      data: {
        outstandingBalance: clientProfile.outstandingBalance,
        paymentHoldAt: clientProfile.paymentHoldAt,
        paymentHoldNote: clientProfile.paymentHoldNote,
      },
    });
  } catch (error) {
    console.error('Error fetching client payment hold:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch client payment hold'));
  }
};

export const releaseClientPaymentHold = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { note } = req.body as { note?: string };

    const clientProfile = await prisma.clientProfile.findUnique({ where: { userId: id } });
    if (!clientProfile) {
      return res.status(404).json(errorResponse(404, 'Client not found'));
    }
    if (!clientProfile.paymentHoldAt) {
      return res.status(409).json(errorResponse(409, 'Client is not currently on hold'));
    }

    const updated = await prisma.clientProfile.update({
      where: { userId: id },
      data: { paymentHoldAt: null, paymentHoldNote: note?.trim() ?? null, outstandingBalance: 0 },
    });

    const owed = await prisma.ledgerLine.aggregate({
      where: { account: 'CLIENT_RECEIVABLE', clientId: id },
      _sum: { amountCentavos: true },
    });
    const owedCentavos = owed._sum.amountCentavos ?? 0;
    if (owedCentavos > 0) {
      await postClientFeeCleared(prisma, id, owedCentavos / 100, `${id}:${updated.updatedAt.toISOString()}`);
    }

    await notifyUser({
      userId: id,
      type: 'ACCOUNT_HOLD_RELEASED',
      title: 'Account hold lifted',
      message: 'Your account is back in good standing — you can book again.',
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'CLIENT_PAYMENT_HOLD_RELEASED',
      category: 'ADMIN_ACTION',
      message: `Released payment hold for client ${id}${note?.trim() ? `: ${note.trim()}` : ''}`,
      metadata: { clientId: id },
    });

    return res.json({ success: true, data: { paymentHoldAt: updated.paymentHoldAt } });
  } catch (error) {
    console.error('Error releasing client payment hold:', error);
    return res.status(500).json(errorResponse(500, 'Failed to release client payment hold'));
  }
};
