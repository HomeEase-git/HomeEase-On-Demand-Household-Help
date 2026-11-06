import { Request, Response } from 'express';
import { KYCStatus, Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatVerification } from '@utils/formatters';
import { ageInYears, workerAgeError } from '@utils/age';
import { getAppSettings } from '@services/appSettingsService';
import { verificationQueue, VERIFICATION_JOB_OPTIONS } from '@queues/verificationQueue';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { TIER_1_REQUIRED_DOCUMENT_TYPES, CLEARANCE_VALIDITY_DAYS } from '@/constants/kycRequirements';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const MIN_OVERRIDE_REASON_LENGTH = 20;

function titleFromDocumentName(originalName: string | null): string {
  const base = (originalName ?? '').replace(/\.[^./]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base || 'Certification (from KYC submission)';
}

async function backfillCertificationsFromKycDocuments(
  tx: Prisma.TransactionClient,
  userId: string,
  documents: Array<{ documentType: string; fileUrl: string; originalName: string | null }>
): Promise<Array<{ id: string; title: string }>> {
  const certDocs = documents.filter((doc) => doc.documentType === 'CERTIFICATION');
  if (!certDocs.length) return [];

  const workerProfile = await tx.workerProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!workerProfile) return [];

  const created: Array<{ id: string; title: string }> = [];
  for (const doc of certDocs) {
    const existing = await tx.certification.findFirst({
      where: { workerProfileId: workerProfile.id, documentUrl: doc.fileUrl },
      select: { id: true },
    });
    if (existing) continue;

    const title = titleFromDocumentName(doc.originalName);
    const certification = await tx.certification.create({
      data: {
        workerProfileId: workerProfile.id,
        title,
        issuer: 'Not yet specified',
        issueDate: new Date(),
        documentUrl: doc.fileUrl,
      },
    });
    created.push({ id: certification.id, title });
  }
  return created;
}

export const listVerifications = async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';
    const type = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const statusFilter =
      status === 'ALL'
        ? undefined
        : status === 'PENDING'
          ? { in: [KYCStatus.PENDING, KYCStatus.SUBMITTED] }
          : (status as KYCStatus);

    const records = await prisma.verificationRequest.findMany({
      where: {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(type === 'worker' ? { user: { role: 'WORKER' } } : {}),
        ...(type === 'client' ? { user: { role: 'CLIENT' } } : {}),
        ...(search
          ? {
              OR: [{ user: { fullName: { contains: search, mode: 'insensitive' } } }, { user: { email: { contains: search, mode: 'insensitive' } } }],
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
        user: { include: { workerProfile: { include: { serviceCategories: { include: { serviceType: true } } } } } },
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
        birthDate: record.user.workerProfile?.birthDate?.toISOString().slice(0, 10) ?? null,
        age: record.user.workerProfile?.birthDate ? ageInYears(record.user.workerProfile.birthDate) : null,
        yearsExperience: record.user.workerProfile?.yearsExperience ?? null,
        serviceCategories:
          record.user.workerProfile?.serviceCategories
            .filter((c) => c.status === 'VERIFIED')
            .map((c) => c.serviceType.name) ?? null,
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
    const { adminOverrideReason, yearsExperience } = req.body as { adminOverrideReason?: string; yearsExperience?: unknown };
    if (
      yearsExperience !== undefined &&
      yearsExperience !== null &&
      (!Number.isInteger(yearsExperience) || (yearsExperience as number) < 0 || (yearsExperience as number) > 60)
    ) {
      return res.status(400).json(errorResponse(400, 'yearsExperience must be a whole number from 0 to 60'));
    }

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

    if (record.userId === req.user?.userId) {
      return res.status(403).json(errorResponse(403, 'You cannot approve your own verification request'));
    }

    if (adminOverrideReason?.trim() && adminOverrideReason.trim().length < MIN_OVERRIDE_REASON_LENGTH) {
      return res.status(400).json(
        errorResponse(400, `adminOverrideReason must be at least ${MIN_OVERRIDE_REASON_LENGTH} characters — explain the actual reason.`)
      );
    }

    if (record.type === 'WORKER_ONBOARDING') {
      const submittedTypes = new Set(record.documents.map((d) => d.documentType));
      const missingTypes = TIER_1_REQUIRED_DOCUMENT_TYPES.filter((t) => !submittedTypes.has(t));

      const workerProfile = record.user.role === 'WORKER'
        ? await prisma.workerProfile.findUnique({
            where: { userId: record.userId },
            select: { addressLat: true, addressLng: true, birthDate: true, yearsExperience: true },
          })
        : null;

      const ageError = workerProfile?.birthDate
        ? workerAgeError(ageInYears(workerProfile.birthDate), await getAppSettings())
        : null;
      if (ageError) {
        return res.status(400).json(errorResponse(400, `Can't approve: ${ageError.toLowerCase()}.`));
      }
      const missingBirthDate = record.user.role === 'WORKER' && !workerProfile?.birthDate;
      const missingExperience =
        record.user.role === 'WORKER' && workerProfile?.yearsExperience == null && yearsExperience == null;

      const missingRequirements = [
        ...missingTypes,
        ...(missingBirthDate ? ['date of birth (confirm the age from the ID)'] : []),
        ...(missingExperience ? ['years of experience'] : []),
      ];
      if (missingRequirements.length > 0 && !adminOverrideReason?.trim()) {
        return res.status(400).json(
          errorResponse(
            400,
            `Missing required documents/info: ${missingRequirements.join(', ')}. Provide adminOverrideReason to approve anyway.`
          )
        );
      }
    }

    const { verification: updated, backfilledCertifications } = await prisma.$transaction(async (tx) => {
      const reviewedAt = new Date();
      for (const doc of record.documents.filter((d) => d.status === 'PENDING')) {
        const validityDays = CLEARANCE_VALIDITY_DAYS[doc.documentType];
        await tx.kycDocument.update({
          where: { id: doc.id },
          data: {
            status: 'APPROVED',
            rejectionReason: null,
            reviewedById: req.user?.userId,
            reviewedAt,
            expiresAt: validityDays
              ? new Date(reviewedAt.getTime() + validityDays * 24 * 60 * 60 * 1000)
              : null,
          },
        });
      }

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

      let backfilledCertifications: Array<{ id: string; title: string }> = [];
      if (record.user.role === 'WORKER') {
        await tx.workerProfile.updateMany({
          where: { userId: record.userId },
          data: {
            kycStatus: 'APPROVED',
            kycApprovedAt: new Date(),
            ...(yearsExperience != null ? { yearsExperience: yearsExperience as number } : {}),
          },
        });
        backfilledCertifications = await backfillCertificationsFromKycDocuments(tx, record.userId, record.documents);
      }

      return { verification, backfilledCertifications };
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
    void sendSmsToUser({
      userId: record.userId,
      message: `HomeEase: ${verificationApprovedMessage}`,
    });

    for (const cert of backfilledCertifications) {
      await notifyUser({
        userId: record.userId,
        type: 'CERTIFICATION_NEEDS_DETAILS',
        title: 'Add details to your certification',
        message: `We added "${cert.title}" to My Certifications from your submitted documents. Add the issuer and date so it can be reviewed.`,
        relatedId: cert.id,
      });
    }

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

    if (record.userId === req.user?.userId) {
      return res.status(403).json(errorResponse(403, 'You cannot reject your own verification request'));
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.kycDocument.updateMany({
        where: { verificationRequestId: id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          rejectionReason: rejectReason.trim(),
          reviewedById: req.user?.userId,
          reviewedAt: new Date(),
        },
      });

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

export const approveDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { id, documentId } = req.params as { id: string; documentId: string };

    const document = await prisma.kycDocument.findFirst({
      where: { id: documentId, verificationRequestId: id },
    });

    if (!document) {
      return res.status(404).json(errorResponse(404, 'Document not found on this verification request'));
    }

    const validityDays = CLEARANCE_VALIDITY_DAYS[document.documentType];
    const expiresAt = validityDays
      ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000)
      : null;

    const updated = await prisma.kycDocument.update({
      where: { id: documentId },
      data: {
        status: 'APPROVED',
        rejectionReason: null,
        reviewedById: req.user?.userId,
        reviewedAt: new Date(),
        expiresAt,
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
