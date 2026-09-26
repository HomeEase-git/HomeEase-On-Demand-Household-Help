import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import type { WorkerServiceCategoryStatus } from '@prisma/client';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// A worker asking to offer another service (WorkerServiceCategory,
// PENDING_VERIFICATION) with the certifications/documents they attached
// (Certification rows tagged to that ServiceType — see
// workerController.runCategoryGate). The admin decides on the request as a
// whole here; approving/rejecting one document from the worker's detail
// page (adminCertificationController) still works too.

const VALID_STATUSES: WorkerServiceCategoryStatus[] = ['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'];

/**
 * GET /api/admin/service-requests?status=PENDING_VERIFICATION
 * Defaults to the review queue. status=ALL lists every request that went
 * through review (i.e. has documents attached).
 */
export const listServiceRequests = async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING_VERIFICATION';
    if (raw !== 'ALL' && !VALID_STATUSES.includes(raw as WorkerServiceCategoryStatus)) {
      return res.status(400).json(errorResponse(400, `status must be ALL or one of ${VALID_STATUSES.join(', ')}`));
    }

    const requests = await prisma.workerServiceCategory.findMany({
      where: {
        ...(raw === 'ALL' ? { gatingCertificationId: { not: null } } : { status: raw as WorkerServiceCategoryStatus }),
      },
      include: {
        serviceType: { select: { id: true, name: true, requiresCertification: true } },
        workerProfile: {
          select: {
            id: true,
            userId: true,
            kycStatus: true,
            user: { select: { fullName: true, email: true, avatar: true } },
            serviceCategories: {
              where: { status: 'VERIFIED' },
              select: { serviceType: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    // Every document the worker attached for that service, newest first.
    const docs = requests.length
      ? await prisma.certification.findMany({
          where: {
            OR: requests.map((r) => ({ workerProfileId: r.workerProfileId, serviceTypeId: r.serviceTypeId })),
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const data = requests.map((r) => ({
      id: r.id,
      status: r.status,
      requestedAt: r.createdAt,
      updatedAt: r.updatedAt,
      verifiedAt: r.verifiedAt,
      rejectedAt: r.rejectedAt,
      serviceType: r.serviceType,
      worker: {
        userId: r.workerProfile.userId,
        fullName: r.workerProfile.user.fullName,
        email: r.workerProfile.user.email,
        avatar: r.workerProfile.user.avatar,
        kycStatus: r.workerProfile.kycStatus,
        currentServices: r.workerProfile.serviceCategories.map((c) => c.serviceType.name),
      },
      documents: docs
        .filter((d) => d.workerProfileId === r.workerProfileId && d.serviceTypeId === r.serviceTypeId)
        .map((d) => ({
          id: d.id,
          title: d.title,
          issuer: d.issuer,
          issueDate: d.issueDate,
          expiryDate: d.expiryDate,
          documentUrl: d.documentUrl,
          verificationStatus: d.verificationStatus,
          rejectionReason: d.rejectionReason,
        })),
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('List service requests error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

async function findPendingRequest(id: string) {
  return prisma.workerServiceCategory.findUnique({
    where: { id },
    include: {
      serviceType: { select: { name: true } },
      workerProfile: { select: { userId: true } },
    },
  });
}

/**
 * PATCH /api/admin/service-requests/:id/approve
 * Approves the request and every still-pending document attached to it; the
 * worker can then pick tasks in that service.
 */
export const approveServiceRequest = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const request = await findPendingRequest(id);
    if (!request) {
      return res.status(404).json(errorResponse(404, 'Service request not found'));
    }
    if (request.status !== 'PENDING_VERIFICATION') {
      return res.status(400).json(errorResponse(400, 'This request is not awaiting review'));
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.certification.updateMany({
        where: {
          workerProfileId: request.workerProfileId,
          serviceTypeId: request.serviceTypeId,
          verificationStatus: 'PENDING',
        },
        data: { verificationStatus: 'APPROVED', rejectionReason: null, reviewedAt: now },
      }),
      prisma.workerServiceCategory.update({
        where: { id },
        data: { status: 'VERIFIED', verifiedAt: now, rejectedAt: null },
      }),
    ]);

    await notifyUser({
      userId: request.workerProfile.userId,
      type: 'SERVICE_CATEGORY_VERIFIED',
      title: 'New service approved',
      message: `Your "${request.serviceType.name}" request was approved. Open Skills & Services to pick the tasks you do.`,
      relatedId: id,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'SERVICE_REQUEST_APPROVED',
      category: 'ADMIN_ACTION',
      message: `Service request "${request.serviceType.name}" approved for worker ${request.workerProfile.userId}`,
      metadata: { workerServiceCategoryId: id, serviceTypeId: request.serviceTypeId },
    });

    return res.json({ success: true, message: 'Service request approved' });
  } catch (error) {
    console.error('Approve service request error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/**
 * PATCH /api/admin/service-requests/:id/reject  { rejectionReason }
 * Declines the request and its still-pending documents. The worker can
 * request the service again with new documents.
 */
export const rejectServiceRequest = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const reason = typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason.trim() : '';
    if (!reason) {
      return res.status(400).json(errorResponse(400, 'rejectionReason is required'));
    }

    const request = await findPendingRequest(id);
    if (!request) {
      return res.status(404).json(errorResponse(404, 'Service request not found'));
    }
    if (request.status !== 'PENDING_VERIFICATION') {
      return res.status(400).json(errorResponse(400, 'This request is not awaiting review'));
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.certification.updateMany({
        where: {
          workerProfileId: request.workerProfileId,
          serviceTypeId: request.serviceTypeId,
          verificationStatus: 'PENDING',
        },
        data: { verificationStatus: 'REJECTED', rejectionReason: reason, reviewedAt: now },
      }),
      prisma.workerServiceCategory.update({
        where: { id },
        data: { status: 'REJECTED', rejectedAt: now },
      }),
    ]);

    await notifyUser({
      userId: request.workerProfile.userId,
      type: 'SERVICE_CATEGORY_REJECTED',
      title: 'Service request declined',
      message: `Your request to add "${request.serviceType.name}" was declined: ${reason}`,
      relatedId: id,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'SERVICE_REQUEST_REJECTED',
      category: 'ADMIN_ACTION',
      message: `Service request "${request.serviceType.name}" rejected for worker ${request.workerProfile.userId}: ${reason}`,
      metadata: { workerServiceCategoryId: id, serviceTypeId: request.serviceTypeId },
    });

    return res.json({ success: true, message: 'Service request rejected' });
  } catch (error) {
    console.error('Reject service request error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
