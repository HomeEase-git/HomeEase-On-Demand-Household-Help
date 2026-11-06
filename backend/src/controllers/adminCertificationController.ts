import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

export const approveCertification = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const certification = await prisma.certification.findUnique({
      where: { id },
      include: { workerProfile: { select: { userId: true } } },
    });
    if (!certification) {
      return res.status(404).json(errorResponse(404, 'Certification not found'));
    }

    const updated = await prisma.certification.update({
      where: { id },
      data: {
        verificationStatus: 'APPROVED',
        rejectionReason: null,
        reviewedAt: new Date(),
      },
    });

    await notifyUser({
      userId: certification.workerProfile.userId,
      type: 'CERTIFICATION_APPROVED',
      title: 'Certification approved',
      message: `Your certification "${certification.title}" has been approved.`,
      relatedId: certification.id,
    });

    const unlockedCategories = await prisma.workerServiceCategory.findMany({
      where: {
        status: 'PENDING_VERIFICATION',
        OR: [
          { gatingCertificationId: certification.id },
          ...(certification.serviceTypeId
            ? [{ workerProfileId: certification.workerProfileId, serviceTypeId: certification.serviceTypeId }]
            : []),
        ],
      },
      include: { serviceType: { select: { name: true } } },
    });
    if (unlockedCategories.length > 0) {
      await prisma.workerServiceCategory.updateMany({
        where: { id: { in: unlockedCategories.map((c) => c.id) } },
        data: { status: 'VERIFIED', verifiedAt: new Date() },
      });
      for (const cat of unlockedCategories) {
        await notifyUser({
          userId: certification.workerProfile.userId,
          type: 'SERVICE_CATEGORY_VERIFIED',
          title: 'New service category approved',
          message: `Your "${cat.serviceType.name}" service is now live — you can start getting bookings for it.`,
          relatedId: cat.id,
        });
      }
    }

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'CERTIFICATION_APPROVED',
      category: 'ADMIN_ACTION',
      message: `Certification "${certification.title}" approved for worker ${certification.workerProfile.userId}`,
      metadata: { certificationId: id, serviceTypeId: certification.serviceTypeId },
    });

    return res.json({ success: true, message: 'Certification approved', data: updated });
  } catch (error) {
    console.error('Approve certification error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const rejectCertification = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { rejectionReason } = req.body as { rejectionReason?: string };

    if (!rejectionReason?.trim()) {
      return res.status(400).json(errorResponse(400, 'rejectionReason is required'));
    }

    const certification = await prisma.certification.findUnique({
      where: { id },
      include: { workerProfile: { select: { userId: true } } },
    });
    if (!certification) {
      return res.status(404).json(errorResponse(404, 'Certification not found'));
    }

    const updated = await prisma.certification.update({
      where: { id },
      data: {
        verificationStatus: 'REJECTED',
        rejectionReason: rejectionReason.trim(),
        reviewedAt: new Date(),
      },
    });

    await notifyUser({
      userId: certification.workerProfile.userId,
      type: 'CERTIFICATION_REJECTED',
      title: 'Certification declined',
      message: `Your certification "${certification.title}" was declined: ${rejectionReason.trim()}`,
      relatedId: certification.id,
    });

    const otherPendingDocs = certification.serviceTypeId
      ? await prisma.certification.count({
          where: {
            workerProfileId: certification.workerProfileId,
            serviceTypeId: certification.serviceTypeId,
            verificationStatus: 'PENDING',
          },
        })
      : 0;
    const declinedCategories =
      otherPendingDocs > 0
        ? []
        : await prisma.workerServiceCategory.findMany({
            where: {
              status: 'PENDING_VERIFICATION',
              OR: [
                { gatingCertificationId: certification.id },
                ...(certification.serviceTypeId
                  ? [{ workerProfileId: certification.workerProfileId, serviceTypeId: certification.serviceTypeId }]
                  : []),
              ],
            },
            include: { serviceType: { select: { name: true } } },
          });
    if (declinedCategories.length > 0) {
      await prisma.workerServiceCategory.updateMany({
        where: { id: { in: declinedCategories.map((c) => c.id) } },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      });
      for (const cat of declinedCategories) {
        await notifyUser({
          userId: certification.workerProfile.userId,
          type: 'SERVICE_CATEGORY_REJECTED',
          title: 'Service category declined',
          message: `Your request to add "${cat.serviceType.name}" was declined: ${rejectionReason.trim()}`,
          relatedId: cat.id,
        });
      }
    }

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'CERTIFICATION_REJECTED',
      category: 'ADMIN_ACTION',
      message: `Certification "${certification.title}" rejected for worker ${certification.workerProfile.userId}: ${rejectionReason.trim()}`,
      metadata: { certificationId: id, serviceTypeId: certification.serviceTypeId },
    });

    return res.json({ success: true, message: 'Certification rejected', data: updated });
  } catch (error) {
    console.error('Reject certification error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
