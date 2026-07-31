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
 * GET /api/workers/:workerId/availability?date=YYYY-MM-DD
 * Returns the booked time slots for a worker on a specific date, so the
 * client's booking calendar can disable them.
 */
export const getWorkerAvailability = async (req: AuthRequest, res: Response) => {
  try {
    const workerId = req.params.workerId as string;
    const { date } = req.query;

    if (!date || typeof date !== 'string') {
      return res.status(400).json(errorResponse(400, 'date query parameter is required'));
    }

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const bookings = await prisma.booking.findMany({
      where: {
        workerId,
        scheduledDate: { gte: dayStart, lte: dayEnd },
        status: { notIn: ['CANCELLED', 'REJECTED'] },
      },
      select: { scheduledTime: true },
    });

    const occupied = bookings
      .map((b) => b.scheduledTime)
      .filter((t): t is string => !!t);

    return res.status(200).json({
      success: true,
      message: 'Worker availability retrieved successfully',
      data: { occupied },
    });
  } catch (error) {
    console.error('Error fetching worker availability:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch worker availability'));
  }
};

/**
 * GET /api/workers/:workerId/blocked-dates
 * Returns dates (within the next 90 days, matching the client calendar's
 * booking window) where the worker already has at least one active booking.
 */
export const getWorkerBlockedDates = async (req: AuthRequest, res: Response) => {
  try {
    const workerId = req.params.workerId as string;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + 90);

    const bookings = await prisma.booking.findMany({
      where: {
        workerId,
        scheduledDate: { gte: today, lte: horizon },
        status: { notIn: ['CANCELLED', 'REJECTED'] },
      },
      select: { scheduledDate: true },
    });

    const dates = Array.from(
      new Set(bookings.map((b) => b.scheduledDate.toISOString().slice(0, 10)))
    );

    return res.status(200).json({
      success: true,
      message: 'Worker blocked dates retrieved successfully',
      data: { dates },
    });
  } catch (error) {
    console.error('Error fetching worker blocked dates:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch worker blocked dates'));
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

/**
 * GET /api/workers/me/skills
 * List the authenticated worker's skills (worker only)
 */
export const listMySkills = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const skills = await prisma.skill.findMany({
      where: { workerProfileId: workerProfile.id },
      orderBy: { createdAt: 'asc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Skills retrieved successfully',
      data: { skills },
    });
  } catch (error) {
    console.error('Error fetching skills:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch skills'));
  }
};

/**
 * POST /api/workers/me/skills
 * Add a skill to the authenticated worker's profile (worker only)
 */
export const createSkill = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { name, category, rate } = req.body;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const skill = await prisma.skill.create({
      data: {
        workerProfileId: workerProfile.id,
        name: name.trim(),
        category: category.trim(),
        rate,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Skill added successfully',
      data: { skill },
    });
  } catch (error) {
    console.error('Error creating skill:', error);
    return res.status(500).json(errorResponse(500, 'Failed to add skill'));
  }
};

/**
 * DELETE /api/workers/me/skills/:skillId
 * Remove a skill from the authenticated worker's profile (worker only)
 */
export const deleteSkill = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const skillId = req.params.skillId as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const skill = await prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill || skill.workerProfileId !== workerProfile.id) {
      return res.status(404).json(errorResponse(404, 'Skill not found'));
    }

    await prisma.skill.delete({ where: { id: skillId } });

    return res.status(200).json({
      success: true,
      message: 'Skill removed successfully',
      data: null,
    });
  } catch (error) {
    console.error('Error deleting skill:', error);
    return res.status(500).json(errorResponse(500, 'Failed to remove skill'));
  }
};

// Maps the Certification model's DB shape onto the field names the mobile
// app's certifications screens already expect (name/status vs title/verificationStatus).
const formatCertification = (cert: {
  id: string;
  title: string;
  issuer: string;
  issueDate: Date;
  expiryDate: Date | null;
  documentUrl: string;
  verificationStatus: string;
  rejectionReason: string | null;
}) => {
  const statusLabel: Record<string, string> = {
    PENDING: 'Pending',
    APPROVED: 'Verified',
    REJECTED: 'Declined',
  };

  return {
    id: cert.id,
    name: cert.title,
    issuer: cert.issuer,
    issueDate: cert.issueDate.toISOString().slice(0, 10),
    expiryDate: cert.expiryDate ? cert.expiryDate.toISOString().slice(0, 10) : null,
    documentUrl: cert.documentUrl,
    status: statusLabel[cert.verificationStatus] ?? cert.verificationStatus,
    rejectionReason: cert.rejectionReason,
  };
};

/**
 * GET /api/workers/me/certifications
 * List the authenticated worker's certifications (worker only)
 */
export const listMyCertifications = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const certifications = await prisma.certification.findMany({
      where: { workerProfileId: workerProfile.id },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Certifications retrieved successfully',
      data: { certifications: certifications.map(formatCertification) },
    });
  } catch (error) {
    console.error('Error fetching certifications:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch certifications'));
  }
};

/**
 * GET /api/workers/me/certifications/:certId
 * Get a single certification belonging to the authenticated worker (worker only)
 */
export const getCertification = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const certId = req.params.certId as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const certification = await prisma.certification.findUnique({ where: { id: certId } });
    if (!certification || certification.workerProfileId !== workerProfile.id) {
      return res.status(404).json(errorResponse(404, 'Certification not found'));
    }

    return res.status(200).json({
      success: true,
      message: 'Certification retrieved successfully',
      data: { certification: formatCertification(certification) },
    });
  } catch (error) {
    console.error('Error fetching certification:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch certification'));
  }
};

/**
 * POST /api/workers/me/certifications
 * Add a certification to the authenticated worker's profile (worker only).
 * The document itself is uploaded separately via
 * POST /api/users/me/kyc-documents/upload (documentType=CERTIFICATION), which
 * returns the documentUrl passed in here.
 */
export const createCertification = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { name, issuer, issueDate, expiryDate, documentUrl } = req.body;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const certification = await prisma.certification.create({
      data: {
        workerProfileId: workerProfile.id,
        title: name.trim(),
        issuer: issuer.trim(),
        issueDate: new Date(issueDate),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        documentUrl,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Certification added successfully',
      data: { certification: formatCertification(certification) },
    });
  } catch (error) {
    console.error('Error creating certification:', error);
    return res.status(500).json(errorResponse(500, 'Failed to add certification'));
  }
};

/**
 * DELETE /api/workers/me/certifications/:certId
 * Remove a certification from the authenticated worker's profile (worker only)
 */
export const deleteCertification = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const certId = req.params.certId as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const certification = await prisma.certification.findUnique({ where: { id: certId } });
    if (!certification || certification.workerProfileId !== workerProfile.id) {
      return res.status(404).json(errorResponse(404, 'Certification not found'));
    }

    await prisma.certification.delete({ where: { id: certId } });

    return res.status(200).json({
      success: true,
      message: 'Certification removed successfully',
      data: null,
    });
  } catch (error) {
    console.error('Error deleting certification:', error);
    return res.status(500).json(errorResponse(500, 'Failed to remove certification'));
  }
};

/**
 * GET /api/workers/me/payout
 * Get the authenticated worker's payout method (worker only)
 */
export const getPayoutMethod = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const worker = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        payoutMethod: true,
        payoutAccountName: true,
        payoutAccountNumber: true,
      },
    });

    if (!worker) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    return res.status(200).json({
      success: true,
      message: 'Payout method retrieved successfully',
      data: worker,
    });
  } catch (error) {
    console.error('Error fetching payout method:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch payout method'));
  }
};

/**
 * PATCH /api/workers/me/payout
 * Set the authenticated worker's payout method (worker only)
 */
export const updatePayoutMethod = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { payoutMethod, payoutAccountName, payoutAccountNumber } = req.body;

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: {
        payoutMethod,
        payoutAccountName: payoutAccountName ?? undefined,
        payoutAccountNumber: payoutAccountNumber ?? undefined,
      },
      select: {
        payoutMethod: true,
        payoutAccountName: true,
        payoutAccountNumber: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Payout method updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating payout method:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update payout method'));
  }
};