import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';

export const getServiceTypes = async (_req: Request, res: Response) => {
  try {
    const services = await prisma.serviceType.findMany({
      include: { tasks: true },
      orderBy: { name: 'asc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Service types retrieved successfully',
      data: services,
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch services'));
  }
};