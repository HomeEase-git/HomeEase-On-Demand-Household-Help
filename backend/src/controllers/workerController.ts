import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * GET /api/workers
 * Search/list workers with filters
 * Query params: category, minRating, maxPrice, page, limit
 */
export const searchWorkers = async (req: AuthRequest, res: Response) => {
  try {
    const { category, minRating, maxPrice, page = '1', limit = '10' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const skip = (pageNum - 1) * limitNum;

    const whereClause: any = {
      isAvailable: true,
    };

    // Filter by service category if provided
    if (category && typeof category === 'string') {
      whereClause.serviceTypes = {
        some: {
          name: {
            contains: category,
            mode: 'insensitive',
          },
        },
      };
    }

    // Filter by minimum rating if provided
    if (minRating) {
      const rating = parseFloat(minRating as string);
      if (!isNaN(rating)) {
        whereClause.rating = { gte: rating };
      }
    }

    // Filter by max base price — price lives on ServiceType, not WorkerProfile
    if (maxPrice) {
      const price = parseFloat(maxPrice as string);
      if (!isNaN(price)) {
        whereClause.serviceTypes = {
          some: {
            ...(whereClause.serviceTypes?.some || {}),
            basePrice: { lte: price },
          },
        };
      }
    }

    const [workers, total] = await Promise.all([
      prisma.workerProfile.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatar: true,   // was: profileImage (field is `avatar` in schema)
            },
          },
          serviceTypes: true,
          reviews: {
            take: 3,
            orderBy: { createdAt: 'desc' },
          },
        },
        skip,
        take: limitNum,
        orderBy: { rating: 'desc' },
      }),
      prisma.workerProfile.count({ where: whereClause }),
    ]);

    const formattedWorkers = workers.map((worker) => ({
      id: worker.userId,
      name: worker.user.fullName,
      service: worker.serviceTypes[0]?.name || 'General Service',
      rating: worker.rating,
      reviews: worker.reviews.length,
      basePrice: worker.serviceTypes[0]?.basePrice ?? null, // was: worker.hourlyRate (doesn't exist)
      status: worker.isAvailable ? 'AVAILABLE' : 'BUSY',
      avatar: worker.user.avatar,  // was: profileImage
    }));

    return res.status(200).json({
      success: true,
      message: 'Workers retrieved successfully',
      data: {
        workers: formattedWorkers,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Error searching workers:', error);
    return res.status(500).json(errorResponse(500, 'Failed to search workers'));
  }
};

/**
 * GET /api/workers/:workerId
 * Get detailed worker profile including ResumeParseResult fields
 */
export const getWorkerDetail = async (req: AuthRequest, res: Response) => {
  try {
    const workerId = req.params.workerId as string;

    const worker = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: {
        id: true,
        userId: true,
        bio: true,
        rating: true,
        totalReviews: true,
        isAvailable: true,
        serviceAreaRadius: true,
        activeJobCount: true,
        availableDays: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        kycStatus: true,
        kycSubmittedAt: true,
        kycApprovedAt: true,
        resumeUrl: true,
        maxConcurrentJobs: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatar: true,
          },
        },
        serviceTypes: true,
        reviews: {
          orderBy: { createdAt: 'desc' },
        },
        certifications: true,
        resumeParseResult: true,
      },
    });

    if (!worker) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    return res.status(200).json({
      success: true,
      message: 'Worker details retrieved successfully',
      data: {
        id: worker.userId,
        name: worker.user.fullName,
        email: worker.user.email,
        phone: worker.user.phone,
        avatar: worker.user.avatar,
        bio: worker.bio,
        rating: worker.rating,
        serviceAreaRadius: worker.serviceAreaRadius,
        address: worker.address,
        city: worker.city,
        state: worker.state,
        zipCode: worker.zipCode,
        isAvailable: worker.isAvailable,
        availableDays: worker.availableDays,
        kycStatus: worker.kycStatus,
        kycSubmittedAt: worker.kycSubmittedAt,
        kycApprovedAt: worker.kycApprovedAt,
        resumeUrl: worker.resumeUrl,
        // Nested relations matching Prisma schema
        resumeParseResult: worker.resumeParseResult,
        certifications: worker.certifications,
        services: worker.serviceTypes,
        verificationStatus: worker.kycStatus === 'APPROVED' ? 'VERIFIED' : 'PENDING',
        reviewCount: worker.reviews.length,
        activeJobCount: worker.activeJobCount,
        maxConcurrentJobs: worker.maxConcurrentJobs,
      },
    });
  } catch (error) {
    console.error('Error fetching worker detail:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch worker details'));
  }
};

/**
 * GET /api/workers/:workerId/reviews
 * Get paginated reviews for a worker
 */
export const getWorkerReviews = async (req: AuthRequest, res: Response) => {
  try {
    const workerId = req.params.workerId as string;
    const { page = '1', limit = '10' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Check if worker exists — workerId param is the User.id (userId on WorkerProfile)
    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    // Review.workerId references WorkerProfile.id, not User.id
    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { workerId: workerProfile.id },
        include: {
          booking: {
            select: {
              id: true,
              serviceTask: {
                select: { name: true },
              },
            },
          },
          client: {              // was: reviewer (relation is `client` in schema)
            select: {
              id: true,
              fullName: true,
              avatar: true,      // was: profileImage
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.review.count({ where: { workerId: workerProfile.id } }),
    ]);

    const formattedReviews = reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      reviewer: {
        id: review.client.id,
        name: review.client.fullName,
        avatar: review.client.avatar,
      },
      serviceType: review.booking?.serviceTask?.name || 'Service',
      // Added so the frontend can link "view booking" from a review without
      // fabricating an id — booking was already fetched above, just wasn't
      // surfaced in the formatted output.
      bookingId: review.booking?.id ?? null,
      createdAt: review.createdAt,
    }));

    return res.status(200).json({
      success: true,
      message: 'Reviews retrieved successfully',
      data: {
        reviews: formattedReviews,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching worker reviews:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch reviews'));
  }
};

/**
 * PATCH /api/workers/me/availability
 * Toggle isAvailable and set availableDays (worker only)
 */
export const updateAvailability = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { isAvailable, availableDays } = req.body;

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: {
        isAvailable,
        availableDays: availableDays || undefined,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Availability updated successfully',
      data: {
        isAvailable: updated.isAvailable,
        availableDays: updated.availableDays,
      },
    });
  } catch (error) {
    console.error('Error updating availability:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update availability'));
  }
};

/**
 * PATCH /api/workers/me/profile
 * Update worker profile fields (worker only)
 */
export const updateWorkerProfile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const {
      bio,
      serviceAreaRadius,
      address,
      city,
      state,
      zipCode,
      kycStatus,
      kycSubmittedAt,
      kycApprovedAt,
      resumeUrl,
    } = req.body;

    const updateData: any = {};
    if (bio !== undefined) updateData.bio = bio;
    if (serviceAreaRadius !== undefined) updateData.serviceAreaRadius = serviceAreaRadius;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (zipCode !== undefined) updateData.zipCode = zipCode;
    if (kycStatus !== undefined) updateData.kycStatus = kycStatus;
    if (kycSubmittedAt !== undefined) updateData.kycSubmittedAt = kycSubmittedAt;
    if (kycApprovedAt !== undefined) updateData.kycApprovedAt = kycApprovedAt;
    if (resumeUrl !== undefined) updateData.resumeUrl = resumeUrl;

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        bio: updated.bio,
        serviceAreaRadius: updated.serviceAreaRadius,
        address: updated.address,
        city: updated.city,
        state: updated.state,
        zipCode: updated.zipCode,
        kycStatus: updated.kycStatus,
        kycSubmittedAt: updated.kycSubmittedAt,
        kycApprovedAt: updated.kycApprovedAt,
        resumeUrl: updated.resumeUrl,
      },
    });
  } catch (error) {
    console.error('Error updating worker profile:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update profile'));
  }
};

/**
 * POST /api/workers/me/service-types
 * Attach ServiceType(s) to worker (worker only)
 */
export const addServiceTypes = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { serviceTypeIds } = req.body;

    // Verify all service types exist
    const serviceTypes = await prisma.serviceType.findMany({
      where: { id: { in: serviceTypeIds } },
    });

    if (serviceTypes.length !== serviceTypeIds.length) {
      return res.status(400).json(errorResponse(400, 'One or more service types do not exist'));
    }

    // Connect service types to worker
    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: {
        serviceTypes: {
          connect: serviceTypeIds.map((id: string) => ({ id })),
        },
      },
      include: { serviceTypes: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Service types added successfully',
      data: { serviceTypes: updated.serviceTypes },
    });
  } catch (error) {
    console.error('Error adding service types:', error);
    return res.status(500).json(errorResponse(500, 'Failed to add service types'));
  }
};

/**
 * GET /api/workers/me/capacity
 * Get worker capacity info (worker only)
 */
export const getWorkerCapacity = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const worker = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        activeJobCount: true,
        maxConcurrentJobs: true,
      },
    });

    if (!worker) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const availableSlots = worker.maxConcurrentJobs - worker.activeJobCount;

    return res.status(200).json({
      success: true,
      message: 'Capacity retrieved successfully',
      data: {
        activeJobCount: worker.activeJobCount,
        maxConcurrentJobs: worker.maxConcurrentJobs,
        availableSlots: Math.max(0, availableSlots),
        isAtCapacity: availableSlots <= 0,
      },
    });
  } catch (error) {
    console.error('Error fetching worker capacity:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch capacity'));
  }
};