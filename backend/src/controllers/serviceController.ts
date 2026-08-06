import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';

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
          where: { isAvailable: true, kycStatus: 'APPROVED' },
          select: { activeJobCount: true, maxConcurrentJobs: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const servicesWithWorkerCount = services.map(({ workers, ...service }) => ({
      ...service,
      availableWorkerCount: workers.filter((w) => w.activeJobCount < w.maxConcurrentJobs).length,
    }));

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