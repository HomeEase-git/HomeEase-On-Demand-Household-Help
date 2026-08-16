import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatDisplayId, formatPeso } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { writeAuditLog } from '@utils/auditLog';
import { getAppSettings } from '@services/appSettingsService';
import { computeWorkerTier } from '@utils/workerTier';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

function buildClientSearchWhere(search: string, status?: string): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { role: 'CLIENT', isDeleted: false };

  if (status && status !== 'all') {
    where.isDeleted = status.toLowerCase() === 'suspended';
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search } },
      { email: { contains: search } },
      { phone: { contains: search } },
    ];
  }

  return where;
}

type ClientRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isDeleted: boolean;
  status: string;
  createdAt: Date;
};

/**
 * Formats a page of clients, fetching every client's bookings in ONE query
 * (grouped in JS by clientId) instead of one `booking.findMany` per client —
 * that per-row query was the biggest N+1 in the admin API, firing on every
 * page load of the Users table.
 */
async function formatClientsBatch(users: ClientRow[]) {
  const bookingsByClient = new Map<
    string,
    Array<{ finalPrice: number | null; estimatedPrice: number | null; status: string }>
  >();

  if (users.length > 0) {
    const bookings = await prisma.booking.findMany({
      where: { clientId: { in: users.map((u) => u.id) } },
      select: { clientId: true, finalPrice: true, estimatedPrice: true, status: true },
    });
    for (const b of bookings) {
      const list = bookingsByClient.get(b.clientId);
      if (list) list.push(b);
      else bookingsByClient.set(b.clientId, [b]);
    }
  }

  return users.map((user) => {
    const bookings = bookingsByClient.get(user.id) ?? [];
    const totalSpent = bookings
      .filter((b) => b.status === 'COMPLETED')
      .reduce((sum, b) => sum + ((b.finalPrice ?? b.estimatedPrice) ?? 0), 0);

    return {
      id: user.id,
      displayId: formatDisplayId(user.id),
      name: user.fullName,
      email: user.email,
      phone: user.phone ?? '—',
      // Real 3-state account status (ACTIVE/SUSPENDED/BANNED) — lowercased for
      // the frontend's existing badge-variant convention.
      status: user.status.toLowerCase(),
      bookings: bookings.length,
      spent: formatPeso(totalSpent),
      joined: user.createdAt.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    };
  });
}

export const listClients = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.toLowerCase() : 'all';

    const where = buildClientSearchWhere(search, status);

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const data = await formatClientsBatch(users);

    return res.json({
      success: true,
      data,
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('List clients error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getClientById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findFirst({
      where: { id, role: 'CLIENT' },
    });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'Client not found'));
    }

    const [client] = await formatClientsBatch([user]);

    const recentBookings = await prisma.booking.findMany({
      where: { clientId: id },
      include: {
        worker: { select: { fullName: true } },
        serviceTask: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return res.json({
      success: true,
      data: {
        ...client,
        recentBookings: recentBookings.map((b) => ({
          id: formatDisplayId(b.id),
          bookingId: b.id,
          service: b.serviceTask?.name ?? '—',
          worker: b.worker?.fullName ?? '—',
          date: b.scheduledDate
            ? b.scheduledDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : b.createdAt.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              }),
          status: b.status,
          amount: (b.finalPrice ?? b.estimatedPrice) != null ? formatPeso(b.finalPrice ?? b.estimatedPrice) : '—',
        })),
      },
    });
  } catch (error) {
    console.error('Get client error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

function buildWorkerSearchWhere(search: string, status?: string): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { role: 'WORKER', isDeleted: false };

  if (status === 'verified') {
    where.workerProfile = { kycStatus: 'APPROVED' };
  } else if (status === 'pending') {
    where.workerProfile = { kycStatus: 'PENDING' };
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search } },
      { email: { contains: search } },
      { workerProfile: { bio: { contains: search } } },
    ];
  }

  return where;
}

type WorkerRow = {
  id: string;
  fullName: string;
  email: string;
  isDeleted: boolean;
  status: string;
  createdAt: Date;
  workerProfile: {
    bio: string | null;
    rating: number;
    totalReviews: number;
    kycStatus: string;
    serviceTypes: Array<{ name: string }>;
    declineCooldownUntil?: Date | null;
  } | null;
};

/**
 * Formats a page of workers, fetching every worker's completed bookings in
 * ONE query (grouped in JS by workerId) instead of one `booking.findMany`
 * per worker — mirrors the same N+1 fix as formatClientsBatch above.
 */
async function formatWorkersBatch(users: WorkerRow[]) {
  const bookingsByWorker = new Map<string, Array<{ finalPrice: number | null; estimatedPrice: number | null }>>();

  if (users.length > 0) {
    const completedBookings = await prisma.booking.findMany({
      where: { workerId: { in: users.map((u) => u.id) }, status: 'COMPLETED' },
      select: { workerId: true, finalPrice: true, estimatedPrice: true },
    });
    for (const b of completedBookings) {
      if (!b.workerId) continue; // where-filtered to non-null, but the field is nullable in the schema
      const list = bookingsByWorker.get(b.workerId);
      if (list) list.push(b);
      else bookingsByWorker.set(b.workerId, [b]);
    }
  }

  // Settings are cached in-memory (60s TTL) so one call up front is enough —
  // no need to re-fetch per worker.
  const tierSettings = await getAppSettings();

  return users.map((user) => {
    const completedBookings = bookingsByWorker.get(user.id) ?? [];
    const earnings = completedBookings.reduce((sum, b) => sum + ((b.finalPrice ?? b.estimatedPrice) ?? 0), 0);

    const tier = user.workerProfile
      ? computeWorkerTier(user.workerProfile.rating, completedBookings.length, tierSettings)
      : 'STANDARD';

    const verificationStatus = user.workerProfile?.kycStatus ?? 'PENDING';
    const statusLabel =
      verificationStatus === 'APPROVED'
        ? 'Verified'
        : verificationStatus === 'REJECTED'
          ? 'Rejected'
          : 'Pending';

    return {
      id: user.id,
      displayId: formatDisplayId(user.id),
      name: user.fullName,
      email: user.email,
      services: user.workerProfile?.serviceTypes?.map((t) => t.name).join(', ') ?? '—',
      rating: user.workerProfile?.rating.toFixed(1) ?? '0.0',
      reviews: user.workerProfile?.totalReviews ?? 0,
      tier,
      status: statusLabel,
      verification: statusLabel,
      // Real account status (ACTIVE/SUSPENDED/BANNED) — distinct from the KYC
      // verification label above, which `status`/`verification` both carry.
      accountStatus: user.status.toLowerCase(),
      declineCooldownUntil: user.workerProfile?.declineCooldownUntil ?? null,
      earnings: formatPeso(earnings),
      joined: user.createdAt.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    };
  });
}

export const listWorkers = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.toLowerCase() : 'all';

    const where = buildWorkerSearchWhere(search, status);

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { workerProfile: { include: { serviceTypes: true } } },
      }),
    ]);

    const data = await formatWorkersBatch(users);

    return res.json({
      success: true,
      data,
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('List workers error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getWorkerById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findFirst({
      where: { id, role: 'WORKER' },
      include: { workerProfile: { include: { serviceTypes: true } } },
    });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const [worker] = await formatWorkersBatch([user]);

    const { declineWindowHours } = await getAppSettings();
    const recentDeclineCount = await prisma.declinedWorker.count({
      where: {
        workerId: id,
        declinedAt: { gte: new Date(Date.now() - declineWindowHours * 60 * 60 * 1000) },
      },
    });

    const recentBookings = await prisma.booking.findMany({
      where: { workerId: id },
      include: { client: { select: { fullName: true } }, serviceTask: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return res.json({
      success: true,
      data: {
        ...worker,
        recentDeclineCount,
        recentBookings: recentBookings.map((b) => ({
          id: formatDisplayId(b.id),
          bookingId: b.id,
          client: b.client.fullName,
          service: b.serviceTask?.name ?? '—',
          date: b.scheduledDate
            ? b.scheduledDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : b.createdAt.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              }),
          earnings: (b.finalPrice ?? b.estimatedPrice) != null ? formatPeso(b.finalPrice ?? b.estimatedPrice) : '—',
          status: b.status,
        })),
      },
    });
  } catch (error) {
    console.error('Get worker error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

async function setUserStatus(
  req: AuthRequest,
  res: Response,
  targetStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED',
  reason?: string,
  notes?: string
) {
  const id = req.params.id as string;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return res.status(404).json(errorResponse(404, 'User not found'));
  }

  const updatedUser = await prisma.user.update({
    where: { id },
    data: {
      isDeleted: targetStatus !== 'ACTIVE',
      deletedAt: targetStatus === 'ACTIVE' ? null : new Date(),
      status: targetStatus,
    },
  });

  await writeAuditLog({
    actorId: req.user?.userId,
    actorName: req.user?.email,
    actorRole: req.user?.role,
    action: 'USER_STATUS_UPDATED',
    category: 'STATUS_CHANGE',
    message: `${user.fullName} status changed to ${targetStatus}${reason ? `: ${reason}` : ''}`,
  });

  return res.json({
    success: true,
    data: {
      id: updatedUser.id,
      status: targetStatus,
      reason: reason ?? null,
      notes: notes ?? null,
    },
  });
}

export const updateUserStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { status, reason, notes } = req.body as { status?: string; reason?: string; notes?: string };

    if (!status || !['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status.toUpperCase())) {
      return res.status(400).json(errorResponse(400, 'Invalid status'));
    }

    return await setUserStatus(req, res, status.toUpperCase() as 'ACTIVE' | 'SUSPENDED' | 'BANNED', reason, notes);
  } catch (error) {
    console.error('Update user status error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/**
 * PATCH /api/admin/workers/:id/suspend (also usable for clients)
 * Thin convenience wrapper around updateUserStatus's SUSPENDED path.
 */
export const suspendUser = async (req: AuthRequest, res: Response) => {
  try {
    const { reason, notes } = req.body as { reason?: string; notes?: string };
    return await setUserStatus(req, res, 'SUSPENDED', reason, notes);
  } catch (error) {
    console.error('Suspend user error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/** PATCH /api/admin/workers/:id/reinstate — clears a suspension/ban. */
export const reinstateUser = async (req: AuthRequest, res: Response) => {
  try {
    const { reason, notes } = req.body as { reason?: string; notes?: string };
    return await setUserStatus(req, res, 'ACTIVE', reason, notes);
  } catch (error) {
    console.error('Reinstate user error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
