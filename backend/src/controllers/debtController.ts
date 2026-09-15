import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
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

    // Every other sensitive admin mutation in this codebase writes an audit
    // log (KYC/VAT approve-reject, dispute resolve, payout retry, user
    // status change) — this one and releaseWorkerHold below were the
    // outliers, letting an admin waive or inflate a worker's owed platform
    // commission with no trace in the actual audit trail.
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

/**
 * GET /api/admin/users/clients/:id/payment-hold
 * A client's outstanding-payment hold, if any — set by
 * adminDisputeController.resolveDispute's RESOLVE_FOR_WORKER action.
 */
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

/**
 * PATCH /api/admin/users/clients/:id/payment-hold/release
 * Lifts a client's payment hold — same shape as releaseWorkerHold above, for
 * the client side of the same "unpaid, on hold" mechanism (see
 * ClientProfile.paymentHoldAt). Use once the client has actually paid out
 * of band, or an admin decides to write the balance off (see also
 * PAY_WORKER_FROM_PLATFORM in adminDisputeController, which leaves the hold
 * in place on purpose since the platform then owns the collection problem —
 * this is the explicit "we're done chasing it" release).
 */
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
