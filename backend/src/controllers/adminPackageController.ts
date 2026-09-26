import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import type { KycDocumentStatus } from '@prisma/client';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// Worker-proposed packages (WorkerPackage) only reach clients once an admin
// approves them. The admin can approve at the worker's price or set their
// own — the approved price is what clients are charged.

const VALID_STATUSES: KycDocumentStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

/** GET /api/admin/packages?status=PENDING (default) | APPROVED | REJECTED | ALL */
export const listPackages = async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';
    if (raw !== 'ALL' && !VALID_STATUSES.includes(raw as KycDocumentStatus)) {
      return res.status(400).json(errorResponse(400, `status must be ALL or one of ${VALID_STATUSES.join(', ')}`));
    }

    const packages = await prisma.workerPackage.findMany({
      where: raw === 'ALL' ? {} : { status: raw as KycDocumentStatus },
      include: {
        serviceType: { select: { id: true, name: true } },
        workerProfile: { select: { userId: true, user: { select: { fullName: true, email: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    return res.json({
      success: true,
      data: packages.map(({ workerProfile, ...p }) => ({
        ...p,
        worker: { userId: workerProfile.userId, fullName: workerProfile.user.fullName, email: workerProfile.user.email },
      })),
    });
  } catch (error) {
    console.error('List packages error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

async function findPackage(id: string) {
  return prisma.workerPackage.findUnique({
    where: { id },
    include: { workerProfile: { select: { userId: true } } },
  });
}

/** PATCH /api/admin/packages/:id/approve  { price? } */
export const approvePackage = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { price } = (req.body ?? {}) as { price?: unknown };
    if (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price) || price <= 0)) {
      return res.status(400).json(errorResponse(400, 'price must be a positive number'));
    }

    const pkg = await findPackage(id);
    if (!pkg) {
      return res.status(404).json(errorResponse(404, 'Package not found'));
    }
    if (pkg.status !== 'PENDING') {
      return res.status(400).json(errorResponse(400, 'This package is not awaiting review'));
    }

    const finalPrice = typeof price === 'number' ? price : pkg.price;
    const updated = await prisma.workerPackage.update({
      where: { id },
      data: {
        status: 'APPROVED',
        price: finalPrice,
        rejectionReason: null,
        reviewedAt: new Date(),
        reviewedById: req.user?.userId ?? null,
      },
    });

    const priceChanged = finalPrice !== pkg.price;
    await notifyUser({
      userId: pkg.workerProfile.userId,
      type: 'PACKAGE_APPROVED',
      title: 'Package approved',
      message: priceChanged
        ? `"${pkg.name}" was approved at ₱${finalPrice.toLocaleString('en-PH')} (you proposed ₱${pkg.price.toLocaleString('en-PH')}). Clients can now add it to bookings.`
        : `"${pkg.name}" was approved. Clients can now add it to bookings.`,
      relatedId: id,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'PACKAGE_APPROVED',
      category: 'ADMIN_ACTION',
      message: `Package "${pkg.name}" approved for worker ${pkg.workerProfile.userId} at ₱${finalPrice}`,
      metadata: { packageId: id, proposedPrice: pkg.price, approvedPrice: finalPrice },
    });

    return res.json({ success: true, message: 'Package approved', data: updated });
  } catch (error) {
    console.error('Approve package error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/** PATCH /api/admin/packages/:id/reject  { rejectionReason } */
export const rejectPackage = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const reason = typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason.trim() : '';
    if (!reason) {
      return res.status(400).json(errorResponse(400, 'rejectionReason is required'));
    }

    const pkg = await findPackage(id);
    if (!pkg) {
      return res.status(404).json(errorResponse(404, 'Package not found'));
    }
    if (pkg.status !== 'PENDING') {
      return res.status(400).json(errorResponse(400, 'This package is not awaiting review'));
    }

    const updated = await prisma.workerPackage.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedById: req.user?.userId ?? null,
      },
    });

    await notifyUser({
      userId: pkg.workerProfile.userId,
      type: 'PACKAGE_REJECTED',
      title: 'Package declined',
      message: `"${pkg.name}" was declined: ${reason}`,
      relatedId: id,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'PACKAGE_REJECTED',
      category: 'ADMIN_ACTION',
      message: `Package "${pkg.name}" rejected for worker ${pkg.workerProfile.userId}: ${reason}`,
      metadata: { packageId: id },
    });

    return res.json({ success: true, message: 'Package rejected', data: updated });
  } catch (error) {
    console.error('Reject package error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
