import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { getAppSettings } from '@services/appSettingsService';
import { computeWorkerTier, tierMultiplier } from '@utils/workerTier';
import { workerSetupCompleteWhere } from '@services/workerSetupService';

export const getServiceTypes = async (_req: Request, res: Response) => {
  try {
    const services = await prisma.serviceType.findMany({
      where: { isActive: true },
      include: {
        tasks: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        workerCategories: {
          where: {
            status: 'VERIFIED',
            workerProfile: {
              isAvailable: true,
              kycStatus: 'APPROVED',
              debtHoldAt: null,
              AND: [workerSetupCompleteWhere()],
            },
          },
          select: {
            workerProfile: { select: { userId: true, rating: true, yearsExperience: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const allWorkerIds = Array.from(
      new Set(services.flatMap((s) => s.workerCategories.map((c) => c.workerProfile.userId)))
    );
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

    const servicesWithWorkerCount = services.map(({ workerCategories, tasks, ...service }) => {
      const workers = workerCategories.map((c) => c.workerProfile);
      const activeTaskPrices = tasks
        .filter((t) => t.isActive && t.basePrice > 0)
        .map((t) => t.basePrice);
      const taskPrices = activeTaskPrices.length ? activeTaskPrices : [service.basePrice];

      const multipliers = workers.length
        ? workers.map((w) => {
            const tier = computeWorkerTier(
              { rating: w.rating, completedJobs: completedByWorkerId.get(w.userId) ?? 0, yearsExperience: w.yearsExperience },
              tierSettings
            );
            return tierMultiplier(tier, tierSettings);
          })
        : [1.0];

      return {
        ...service,
        tasks,
        availableWorkerCount: workers.length,
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