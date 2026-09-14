import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * GET /api/admin/vat-registrations?status=PENDING
 * Defaults to PENDING (the admin review queue) — pass status=ALL to see
 * every worker with a VAT claim on file, including already-reviewed ones.
 */
export const listVatRegistrations = async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';

    const workers = await prisma.workerProfile.findMany({
      where: {
        vatVerificationStatus: status === 'ALL' ? { not: null } : (status as 'PENDING' | 'APPROVED' | 'REJECTED'),
      },
      select: {
        userId: true,
        vatRegistered: true,
        vatDocumentUrl: true,
        vatVerificationStatus: true,
        vatRejectionReason: true,
        vatSubmittedAt: true,
        vatReviewedAt: true,
        user: { select: { fullName: true, email: true } },
      },
      orderBy: { vatSubmittedAt: 'desc' },
    });

    return res.json({ success: true, data: workers });
  } catch (error) {
    console.error('List VAT registrations error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const approveVatRegistration = async (req: AuthRequest, res: Response) => {
  try {
    const workerId = req.params.workerId as string;

    const worker = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { vatVerificationStatus: true },
    });
    if (!worker) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }
    if (worker.vatVerificationStatus !== 'PENDING') {
      return res.status(400).json(errorResponse(400, 'This VAT registration is not awaiting review'));
    }

    await prisma.workerProfile.update({
      where: { userId: workerId },
      data: {
        vatRegistered: true,
        vatVerificationStatus: 'APPROVED',
        vatRejectionReason: null,
        vatReviewedAt: new Date(),
        vatReviewedById: req.user?.userId,
      },
    });

    await notifyUser({
      userId: workerId,
      type: 'VAT_REGISTRATION_APPROVED',
      title: 'VAT Registration Approved',
      message: 'Your VAT registration has been verified. VAT will now apply to your future bookings.',
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'VAT_REGISTRATION_APPROVED',
      category: 'STATUS_CHANGE',
      message: `VAT registration approved for worker ${workerId}`,
    });

    return res.json({ success: true, message: 'VAT registration approved', data: null });
  } catch (error) {
    console.error('Approve VAT registration error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const rejectVatRegistration = async (req: AuthRequest, res: Response) => {
  try {
    const workerId = req.params.workerId as string;
    const { rejectionReason } = req.body as { rejectionReason?: string };

    if (!rejectionReason?.trim()) {
      return res.status(400).json(errorResponse(400, 'rejectionReason is required'));
    }

    const worker = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { vatVerificationStatus: true },
    });
    if (!worker) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }
    if (worker.vatVerificationStatus !== 'PENDING') {
      return res.status(400).json(errorResponse(400, 'This VAT registration is not awaiting review'));
    }

    // vatRegistered is deliberately left untouched — a rejection only ever
    // matters if it was already true from a prior approval and this is a
    // reverification; a first-time claim being rejected has nothing to undo.
    await prisma.workerProfile.update({
      where: { userId: workerId },
      data: {
        vatVerificationStatus: 'REJECTED',
        vatRejectionReason: rejectionReason.trim(),
        vatReviewedAt: new Date(),
        vatReviewedById: req.user?.userId,
      },
    });

    await notifyUser({
      userId: workerId,
      type: 'VAT_REGISTRATION_REJECTED',
      title: 'VAT Registration Rejected',
      message: `Your VAT registration submission was rejected: ${rejectionReason.trim()}`,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'VAT_REGISTRATION_REJECTED',
      category: 'STATUS_CHANGE',
      message: `VAT registration rejected for worker ${workerId}: ${rejectionReason.trim()}`,
    });

    return res.json({ success: true, message: 'VAT registration rejected', data: null });
  } catch (error) {
    console.error('Reject VAT registration error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
