import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { getAppSettings } from '@services/appSettingsService';
import { computeWorkerTier, tierMultiplier } from '@utils/workerTier';

export const getServiceTypes = async (_req: Request, res: Response) => {
  try {
    const services = await prisma.serviceType.findMany({
      where: { isActive: true },
      include: {
        tasks: true,
        scopeFields: {
          orderBy: { sortOrder: 'asc' },
          include: { options: { orderBy: { sortOrder: 'asc' } } },
        },
        // Capacity (activeJobCount < maxConcurrentJobs) can't be compared in
        // a Prisma `where` since both are columns on the same row, so it's
        // filtered in memory below — same pattern as workerController's
        // searchWorkers.
        workers: {
          where: { isAvailable: true, kycStatus: 'APPROVED', debtHoldAt: null },
          select: { userId: true, rating: true, activeJobCount: true, maxConcurrentJobs: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Batch-compute each worker's tier (same rating+completed-jobs formula as
    // workerController's searchWorkers) so the price range below reflects
    // what a client could actually be charged — cheapest task at the
    // cheapest available worker's tier, up to the priciest task at the
    // priciest tier — instead of the old single admin-set basePrice, which
    // didn't even match the cheapest task in most categories.
    const allWorkerIds = Array.from(new Set(services.flatMap((s) => s.workers.map((w) => w.userId))));
    const [tierSettings, completedCounts] = await Promise.all([
      getAppSettings(),
      allWorkerIds.length
        ? prisma.booking.groupBy({
            by: ['workerId'],
            where: { workerId: { in: allWorkerIds }, status: 'COMPLETED' },
            _count: { _all: true },
          })
        : Promise.resolve([] as { workerId: string; _count: { _all: number } }[]),
    ]);
    const completedByWorkerId = new Map(completedCounts.map((c) => [c.workerId, c._count._all]));

    const servicesWithWorkerCount = services.map(({ workers, tasks, ...service }) => {
      const activeTaskPrices = tasks.filter((t) => t.isActive).map((t) => t.basePrice);
      const taskPrices = activeTaskPrices.length ? activeTaskPrices : [service.basePrice];

      const multipliers = workers.length
        ? workers.map((w) => {
            const tier = computeWorkerTier(w.rating, completedByWorkerId.get(w.userId) ?? 0, tierSettings);
            return tierMultiplier(tier, tierSettings);
          })
        : [1.0];

      return {
        ...service,
        tasks,
        availableWorkerCount: workers.filter((w) => w.activeJobCount < w.maxConcurrentJobs).length,
        priceRangeMin: Math.round(Math.min(...taskPrices) * Math.min(...multipliers)),
        priceRangeMax: Math.round(Math.max(...taskPrices) * Math.max(...multipliers)),
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Service types retrieved successfully',
      data: servicesWithWorkerCount,
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch services'));
  }
};