import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatVerification } from '@utils/formatters';
import { verificationQueue, VERIFICATION_JOB_OPTIONS } from '@queues/verificationQueue';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// Tier 1 minimum documents (see documents.MD) required before a worker's
// initial onboarding verification can be approved without an explicit
// admin override.
const TIER_1_REQUIRED_DOCUMENT_TYPES = [
  'GOVERNMENT_ID_FRONT',
  'GOVERNMENT_ID_BACK',
  'SELFIE',
  'NBI_CLEARANCE',
] as const;

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
        user: { include: { workerProfile: { include: { serviceTypes: true } } } },
        documents: true,
      },
    });

    if (!record) {
      return res.status(404).json(errorResponse(404, 'Verification request not found'));
    }

    return res.json({
      success: true,
      data: {
        ...formatVerification(record),
        serviceCategories: record.user.workerProfile?.serviceTypes.map((s) => s.name) ?? null,
      },
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

    if (record.type === 'WORKER_ONBOARDING') {
      const submittedTypes = new Set(record.documents.map((d) => d.documentType));
      const missingTypes = TIER_1_REQUIRED_DOCUMENT_TYPES.filter((t) => !submittedTypes.has(t));
      if (missingTypes.length > 0 && !adminOverrideReason?.trim()) {
        return res.status(400).json(
          errorResponse(
            400,
            `Missing required documents: ${missingTypes.join(', ')}. Provide adminOverrideReason to approve anyway.`
          )
        );
      }
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

    const verificationApprovedMessage =
      record.user.role === 'WORKER'
        ? "You're verified! You can now start accepting jobs."
        : 'Your account verification has been approved.';

    await notifyUser({
      userId: record.userId,
      type: 'VERIFICATION_APPROVED',
      title: 'Verification Approved',
      message: verificationApprovedMessage,
      relatedId: record.id,
    });
    // A worker's KYC approval unlocks their ability to earn and they're
    // actively waiting on it — worth the SMS even though this only fires
    // once per account.
    void sendSmsToUser({
      userId: record.userId,
      message: `HomeEase: ${verificationApprovedMessage}`,
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

    await notifyUser({
      userId: record.userId,
      type: 'VERIFICATION_REJECTED',
      title: 'Verification Rejected',
      message: `Your verification was rejected: ${rejectReason.trim()}`,
      relatedId: record.id,
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

/**
 * PATCH /api/admin/verifications/:id/documents/:documentId/approve
 * Approves a single document within a verification submission, without
 * approving the whole request — lets an admin accept the ID while still
 * waiting on/rejecting the selfie or a clearance, for example.
 */
export const approveDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { id, documentId } = req.params as { id: string; documentId: string };

    const document = await prisma.kycDocument.findFirst({
      where: { id: documentId, verificationRequestId: id },
    });

    if (!document) {
      return res.status(404).json(errorResponse(404, 'Document not found on this verification request'));
    }

    const updated = await prisma.kycDocument.update({
      where: { id: documentId },
      data: {
        status: 'APPROVED',
        rejectionReason: null,
        reviewedById: req.user?.userId,
        reviewedAt: new Date(),
      },
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'KYC_DOCUMENT_APPROVED',
      category: 'ADMIN_ACTION',
      message: `Document ${document.documentType} approved for verification ${id}`,
      metadata: { verificationRequestId: id, documentId },
    });

    return res.json({ success: true, message: 'Document approved', data: updated });
  } catch (error) {
    console.error('Approve document error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/**
 * PATCH /api/admin/verifications/:id/documents/:documentId/reject
 */
export const rejectDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { id, documentId } = req.params as { id: string; documentId: string };
    const { rejectReason } = req.body as { rejectReason?: string };

    if (!rejectReason?.trim()) {
      return res.status(400).json(errorResponse(400, 'Rejection reason is required'));
    }

    const document = await prisma.kycDocument.findFirst({
      where: { id: documentId, verificationRequestId: id },
    });

    if (!document) {
      return res.status(404).json(errorResponse(404, 'Document not found on this verification request'));
    }

    const updated = await prisma.kycDocument.update({
      where: { id: documentId },
      data: {
        status: 'REJECTED',
        rejectionReason: rejectReason.trim(),
        reviewedById: req.user?.userId,
        reviewedAt: new Date(),
      },
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'KYC_DOCUMENT_REJECTED',
      category: 'ADMIN_ACTION',
      message: `Document ${document.documentType} rejected for verification ${id}: ${rejectReason.trim()}`,
      metadata: { verificationRequestId: id, documentId },
    });

    return res.json({ success: true, message: 'Document rejected', data: updated });
  } catch (error) {
    console.error('Reject document error:', error);
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

    await verificationQueue.add(
      'analyze-verification',
      {
        verificationId: record.id,
        requestType: record.type,
        documents: record.documents.map((doc) => ({
          documentType: doc.documentType,
          fileUrl: doc.fileUrl,
          mimeType: doc.mimeType,
          originalName: doc.originalName,
        })),
      },
      VERIFICATION_JOB_OPTIONS
    );

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
