import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatVerification } from '@utils/formatters';
import { verificationQueue } from '@queues/verificationQueue';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

export const listVerifications = async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';
    const type = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const records = await prisma.verificationRequest.findMany({
      where: {
        ...(status !== 'ALL' ? { status: status as 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' } : {}),
        ...(type === 'worker' ? { user: { role: 'WORKER' } } : {}),
        ...(type === 'client' ? { user: { role: 'CLIENT' } } : {}),
        ...(search
          ? {
              OR: [{ user: { fullName: { contains: search } } }, { user: { email: { contains: search } } }],
            }
          : {}),
      },
      include: {
        user: true,
        documents: true,
      },
      orderBy: { submittedAt: 'desc' },
    });

    return res.json({
      success: true,
      data: records.map(formatVerification),
    });
  } catch (error) {
    console.error('List verifications error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getVerificationById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const record = await prisma.verificationRequest.findUnique({
      where: { id },
      include: {
        user: true,
        documents: true,
      },
    });

    if (!record) {
      return res.status(404).json(errorResponse(404, 'Verification request not found'));
    }

    return res.json({
      success: true,
      data: formatVerification(record),
    });
  } catch (error) {
    console.error('Get verification error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const approveVerification = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { adminOverrideReason } = req.body as { adminOverrideReason?: string };

    const record = await prisma.verificationRequest.findUnique({
      where: { id },
      include: { user: true, documents: true },
    });

    if (!record) {
      return res.status(404).json(errorResponse(404, 'Verification request not found'));
    }

    if (record.status === 'APPROVED') {
      return res.status(400).json(errorResponse(400, 'Verification already approved'));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const verification = await tx.verificationRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          rejectionReason: null,
          adminOverrideReason: adminOverrideReason?.trim() || null,
          reviewedById: req.user?.userId,
          reviewedAt: new Date(),
        },
        include: { user: true, documents: true },
      });

      if (record.user.role === 'WORKER') {
        await tx.workerProfile.updateMany({
          where: { userId: record.userId },
          data: { kycStatus: 'APPROVED', kycApprovedAt: new Date() },
        });
      }

      return verification;
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'VERIFICATION_APPROVED',
      category: 'STATUS_CHANGE',
      message: `Verification approved for ${record.user.fullName}`,
    });

    return res.json({
      success: true,
      message: 'Verification approved successfully',
      data: formatVerification(updated),
    });
  } catch (error) {
    console.error('Approve verification error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const rejectVerification = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { rejectReason } = req.body as { rejectReason?: string };

    if (!rejectReason?.trim()) {
      return res.status(400).json(errorResponse(400, 'Rejection reason is required'));
    }

    const record = await prisma.verificationRequest.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!record) {
      return res.status(404).json(errorResponse(404, 'Verification request not found'));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const verification = await tx.verificationRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectionReason: rejectReason.trim(),
          reviewedById: req.user?.userId,
          reviewedAt: new Date(),
        },
        include: { user: true, documents: true },
      });

      if (record.user.role === 'WORKER') {
        await tx.workerProfile.updateMany({
          where: { userId: record.userId },
          data: { kycStatus: 'REJECTED' },
        });
      }

      return verification;
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'VERIFICATION_REJECTED',
      category: 'STATUS_CHANGE',
      message: `Verification rejected for ${record.user.fullName}: ${rejectReason.trim()}`,
    });

    return res.json({
      success: true,
      message: 'Verification rejected',
      data: formatVerification(updated),
    });
  } catch (error) {
    console.error('Reject verification error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const rerunVerification = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const record = await prisma.verificationRequest.findUnique({
      where: { id },
      include: { documents: true, user: true },
    });

    if (!record) {
      return res.status(404).json(errorResponse(404, 'Verification request not found'));
    }

    if (record.status === 'APPROVED') {
      return res.status(400).json(errorResponse(400, 'Cannot rerun AI review for approved verification'));
    }

    await verificationQueue.add('analyze-verification', {
      verificationId: record.id,
      requestType: record.type,
      documents: record.documents.map((doc) => ({
        documentType: doc.documentType,
        fileUrl: doc.fileUrl,
        mimeType: doc.mimeType,
        originalName: doc.originalName,
      })),
    });

    const updated = await prisma.verificationRequest.update({
      where: { id },
      data: {
        aiStatus: 'PENDING',
        aiSummary: null,
        aiConfidence: null,
        aiError: null,
      },
      include: { user: true, documents: true },
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'VERIFICATION_RERUN',
      category: 'ADMIN_ACTION',
      message: `AI review rerun queued for ${record.user.fullName}`,
    });

    return res.json({
      success: true,
      message: 'AI review rerun queued',
      data: formatVerification(updated),
    });
  } catch (error) {
    console.error('Rerun verification error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
