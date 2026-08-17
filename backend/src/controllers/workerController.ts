import { Request, Response } from 'express';
import type { ConditionType, RoomType, TimeSlot } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { toDayStart } from '@services/workerAvailabilityService';
import { getAppSettings } from '@services/appSettingsService';
import { parseWorkerResume } from '@services/resumeParseService';
import { computeWorkerTier, tierMultiplier } from '@utils/workerTier';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const VALID_TIME_SLOTS: TimeSlot[] = ['MORNING', 'AFTERNOON', 'EVENING'];
const VALID_CONDITIONS: ConditionType[] = ['TIDY', 'NORMAL', 'HEAVY'];
const VALID_ROOM_TYPES: RoomType[] = [
  'BEDROOM',
  'BATHROOM',
  'KITCHEN',
  'LIVING_ROOM',
  'DINING_ROOM',
  'OFFICE',
  'GARAGE',
  'BALCONY',
  'OTHER',
];
// Search has no specific ServiceTask (that's picked in a later booking step),
// so estimatedTotal for an hourly-rate worker uses a flat assumed duration —
// documented here since it's the one non-obvious number in the card payload.
const DEFAULT_ESTIMATE_HOURS = 2;

/**
 * GET /api/workers
 * Worker discovery search (public). Query params:
 *   serviceType, date (YYYY-MM-DD), timeSlot, condition, rooms (comma-separated
 *   RoomType), page, limit
 *   — plus legacy category/minRating/maxPrice, kept for existing callers.
 *
 * Filters to isAvailable + kycStatus APPROVED workers under capacity, with an
 * open (date, timeSlot) slot when both are given, offering serviceType, and —
 * when condition/rooms are given — matching the worker's job preferences.
 * Sorted by rating (there's no reliable worker location data to sort/filter
 * by proximity — see matchingService.ts for the same reasoning on auto-match).
 */
export const searchWorkers = async (req: AuthRequest, res: Response) => {
  try {
    const {
      serviceType,
      category,
      date,
      timeSlot,
      condition,
      rooms,
      minRating,
      maxPrice,
      page = '1',
      limit = '10',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));

    if (timeSlot !== undefined && !VALID_TIME_SLOTS.includes(timeSlot as TimeSlot)) {
      return res.status(400).json(errorResponse(400, `timeSlot must be one of ${VALID_TIME_SLOTS.join(', ')}`));
    }
    if (condition !== undefined && !VALID_CONDITIONS.includes(condition as ConditionType)) {
      return res.status(400).json(errorResponse(400, `condition must be one of ${VALID_CONDITIONS.join(', ')}`));
    }
    if (date !== undefined && (typeof date !== 'string' || isNaN(new Date(date).getTime()))) {
      return res.status(400).json(errorResponse(400, 'date must be a valid YYYY-MM-DD date'));
    }

    const requestedRooms = typeof rooms === 'string'
      ? rooms.split(',').map((r) => r.trim().toUpperCase()).filter((r): r is RoomType => VALID_ROOM_TYPES.includes(r as RoomType))
      : [];

    const serviceTypeName = typeof serviceType === 'string' ? serviceType : typeof category === 'string' ? category : undefined;

    const whereClause: any = {
      isAvailable: true,
      kycStatus: 'APPROVED',
    };

    if (serviceTypeName) {
      whereClause.serviceTypes = { some: { name: { contains: serviceTypeName, mode: 'insensitive' } } };
    }

    if (minRating) {
      const rating = parseFloat(minRating as string);
      if (!isNaN(rating)) whereClause.rating = { gte: rating };
    }

    if (maxPrice) {
      const price = parseFloat(maxPrice as string);
      if (!isNaN(price)) {
        whereClause.serviceTypes = {
          some: { ...(whereClause.serviceTypes?.some || {}), basePrice: { lte: price } },
        };
      }
    }

    if (condition === 'HEAVY') {
      whereClause.acceptsHeavyCondition = true;
    }

    let dayStart: Date | null = null;
    if (typeof date === 'string') {
      dayStart = toDayStart(date);
      whereClause.availability = {
        some: {
          date: dayStart,
          isBlocked: false,
          isBooked: false,
          ...(timeSlot !== undefined ? { timeSlot: timeSlot as TimeSlot } : {}),
        },
      };
    }

    // capacity: activeJobCount < maxConcurrentJobs — expressed as a raw
    // filter since Prisma can't compare two columns of the same row directly.
    const candidates = await prisma.workerProfile.findMany({
      where: whereClause,
      include: {
        user: { select: { id: true, fullName: true, avatar: true } },
        serviceTypes: true,
        availability: dayStart ? { where: { date: dayStart, isBlocked: false, isBooked: false } } : false,
      },
      // Bounded candidate pool — the radius/rating/distance ranking below
      // runs in memory (see file header comment), so this caps how much a
      // single request can pull before that pass.
      take: 500,
    });

    const filtered = candidates.filter((w) => w.activeJobCount < w.maxConcurrentJobs);

    const roomFiltered = requestedRooms.length > 0
      ? filtered.filter((w) => w.preferredRoomTypes.length === 0 || w.preferredRoomTypes.some((r) => requestedRooms.includes(r)))
      : filtered;

    roomFiltered.sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.totalReviews - a.totalReviews;
    });

    const total = roomFiltered.length;
    const start = (pageNum - 1) * limitNum;
    const page_ = roomFiltered.slice(start, start + limitNum);

    // Expertise tier — computed live from rating + completed-job count (see
    // utils/workerTier.ts). Batched over just this page, not all candidates.
    // Independent of each other, so run in parallel rather than serially.
    const [tierSettings, completedCounts] = await Promise.all([
      getAppSettings(),
      prisma.booking.groupBy({
        by: ['workerId'],
        where: { workerId: { in: page_.map((w) => w.userId) }, status: 'COMPLETED' },
        _count: { _all: true },
      }),
    ]);
    const completedByWorkerId = new Map(completedCounts.map((c) => [c.workerId as string, c._count._all]));

    const cards = page_.map((worker) => {
      const matchedServiceType =
        worker.serviceTypes.find((st) => serviceTypeName && st.name.toLowerCase() === serviceTypeName.toLowerCase()) ??
        worker.serviceTypes[0];

      const estimatedTotal =
        worker.hourlyRate != null
          ? Math.round(worker.hourlyRate * DEFAULT_ESTIMATE_HOURS * 100) / 100
          : matchedServiceType?.basePrice ?? null;

      const badges: string[] = ['VERIFIED'];
      if (worker.rating >= 4.8 && worker.totalReviews >= 20) badges.push('TOP_RATED');
      if (worker.totalReviews === 0) badges.push('NEW');
      if (condition === 'HEAVY' && worker.acceptsHeavyCondition) badges.push('HEAVY_DUTY_READY');

      const completedJobs = completedByWorkerId.get(worker.userId) ?? 0;
      const tier = computeWorkerTier(worker.rating, completedJobs, tierSettings);
      if (tier === 'PRO') badges.push('PRO_TIER');
      if (tier === 'EXPERT') badges.push('EXPERT_TIER');

      return {
        id: worker.userId,
        fullName: worker.user.fullName,
        avatar: worker.user.avatar,
        rating: worker.rating,
        totalReviews: worker.totalReviews,
        hourlyRate: worker.hourlyRate,
        estimatedTotal:
          estimatedTotal != null ? Math.round(estimatedTotal * tierMultiplier(tier, tierSettings) * 100) / 100 : null,
        tier,
        // Lets the client fetch this worker's packages for the selected
        // category later in the booking flow without an extra round-trip.
        matchedServiceTypeId: matchedServiceType?.id ?? null,
        service: matchedServiceType?.name ?? 'General service',
        serviceTypeNames: worker.serviceTypes.map((st) => st.name),
        // At-capacity workers are already filtered out above — these are
        // exposed so a still-available worker's current load can be shown
        // (e.g. "1 active job"), not to signal fullness.
        activeJobCount: worker.activeJobCount,
        maxConcurrentJobs: worker.maxConcurrentJobs,
        badges,
        openSlots: dayStart ? worker.availability.map((a) => a.timeSlot) : [],
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Workers retrieved successfully',
      data: {
        workers: cards,
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
        hourlyRate: true,
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
        // Only the count is used below (reviewCount) — select just that
        // instead of pulling every review row (comment, photos, etc.) for it.
        _count: { select: { reviews: true } },
        certifications: true,
        resumeParseResult: true,
      },
    });

    if (!worker) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    if (worker.kycStatus !== 'APPROVED') {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const [tierSettings, completedJobs] = await Promise.all([
      getAppSettings(),
      prisma.booking.count({ where: { workerId: worker.userId, status: 'COMPLETED' } }),
    ]);
    const tier = computeWorkerTier(worker.rating, completedJobs, tierSettings);

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
        tier,
        serviceAreaRadius: worker.serviceAreaRadius,
        address: worker.address,
        city: worker.city,
        state: worker.state,
        zipCode: worker.zipCode,
        isAvailable: worker.isAvailable,
        availableDays: worker.availableDays,
        hourlyRate: worker.hourlyRate,
        kycStatus: worker.kycStatus,
        kycSubmittedAt: worker.kycSubmittedAt,
        kycApprovedAt: worker.kycApprovedAt,
        resumeUrl: worker.resumeUrl,
        // Nested relations matching Prisma schema
        resumeParseResult: worker.resumeParseResult,
        certifications: worker.certifications,
        services: worker.serviceTypes,
        verificationStatus: worker.kycStatus === 'APPROVED' ? 'VERIFIED' : 'PENDING',
        reviewCount: worker._count.reviews,
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
 * GET /api/workers/me/digital-id
 * Self-serve digital ID card data for the logged-in worker. Unlike the public
 * getWorkerDetail above, this does NOT gate on kycStatus === 'APPROVED' — a
 * worker needs to see their own pending state, not a 404.
 */
export const getMyDigitalId = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const worker = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        id: true,
        kycStatus: true,
        kycApprovedAt: true,
        rating: true,
        totalReviews: true,
        digitalIdTrade: true,
        digitalIdServiceArea: true,
        licenseNumber: true,
        user: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
          },
        },
      },
    });

    if (!worker) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    return res.status(200).json({
      success: true,
      message: 'Digital ID retrieved successfully',
      data: {
        id: worker.user.id,
        name: worker.user.fullName,
        avatar: worker.user.avatar,
        rating: worker.rating,
        totalReviews: worker.totalReviews,
        kycStatus: worker.kycStatus,
        kycApprovedAt: worker.kycApprovedAt,
        verified: worker.kycStatus === 'APPROVED',
        badgeId: `HE-${worker.user.id.slice(-8).toUpperCase()}`,
        trade: worker.digitalIdTrade,
        serviceArea: worker.digitalIdServiceArea,
        licenseNumber: worker.licenseNumber,
      },
    });
  } catch (error) {
    console.error('Error fetching digital ID:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch digital ID'));
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
      select: { id: true, kycStatus: true },
    });

    if (!workerProfile || workerProfile.kycStatus !== 'APPROVED') {
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
      photoUrls: review.photoUrls,
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

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { kycStatus: true },
    });

    if (!workerProfile || workerProfile.kycStatus !== 'APPROVED') {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
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

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { kycStatus: true },
    });

    if (!workerProfile || workerProfile.kycStatus !== 'APPROVED') {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

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
 * GET /api/workers/me/profile
 * Self-service profile read (worker only) — unlike GET /workers/:workerId
 * (the public detail view), this includes addressLat/addressLng, which
 * should never be exposed on the public endpoint since it's the worker's
 * precise home/service coordinates, not just a text address.
 */
export const getMyWorkerProfile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const profile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        bio: true,
        serviceAreaRadius: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        addressLat: true,
        addressLng: true,
        resumeUrl: true,
        digitalIdTrade: true,
        digitalIdServiceArea: true,
        licenseNumber: true,
        kycStatus: true,
        kycSubmittedAt: true,
        kycApprovedAt: true,
      },
    });

    if (!profile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    return res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: profile,
    });
  } catch (error) {
    console.error('Error fetching worker profile:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch profile'));
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
      addressLat,
      addressLng,
      resumeUrl,
      digitalIdTrade,
      digitalIdServiceArea,
      licenseNumber,
      // kycStatus/kycSubmittedAt/kycApprovedAt are deliberately NOT accepted
      // here — this is a worker self-service endpoint, and those fields
      // must only ever be set by admin review (adminVerificationController)
      // or the server-side contract-acceptance flow (userController.
      // acceptContract), never by the worker's own request body.
    } = req.body;

    const updateData: any = {};
    if (bio !== undefined) updateData.bio = bio;
    if (serviceAreaRadius !== undefined) updateData.serviceAreaRadius = serviceAreaRadius;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (zipCode !== undefined) updateData.zipCode = zipCode;
    // addressLat/addressLng are the geocoded coordinates for the address
    // above — used to compute the distance-based pricing fee at booking
    // time (see bookingController.createBooking). Not matching/search input.
    if (addressLat !== undefined) updateData.addressLat = addressLat;
    if (addressLng !== undefined) updateData.addressLng = addressLng;
    if (resumeUrl !== undefined) updateData.resumeUrl = resumeUrl;
    if (digitalIdTrade !== undefined) updateData.digitalIdTrade = digitalIdTrade;
    if (digitalIdServiceArea !== undefined) updateData.digitalIdServiceArea = digitalIdServiceArea;
    if (licenseNumber !== undefined) updateData.licenseNumber = licenseNumber;

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
        addressLat: updated.addressLat,
        addressLng: updated.addressLng,
        kycStatus: updated.kycStatus,
        kycSubmittedAt: updated.kycSubmittedAt,
        kycApprovedAt: updated.kycApprovedAt,
        resumeUrl: updated.resumeUrl,
        digitalIdTrade: updated.digitalIdTrade,
        digitalIdServiceArea: updated.digitalIdServiceArea,
        licenseNumber: updated.licenseNumber,
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
 * GET /api/workers/me/service-types
 * List the authenticated worker's connected service types (worker only)
 */
export const listMyServiceTypes = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { serviceTypes: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    return res.status(200).json({
      success: true,
      message: 'Service types retrieved successfully',
      data: { serviceTypes: workerProfile.serviceTypes },
    });
  } catch (error) {
    console.error('Error fetching service types:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch service types'));
  }
};

/**
 * DELETE /api/workers/me/service-types/:serviceTypeId
 * Remove a service type from the authenticated worker's profile (worker only)
 */
export const removeServiceType = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const serviceTypeId = req.params.serviceTypeId as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, serviceTypes: { where: { id: serviceTypeId }, select: { id: true } } },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    if (workerProfile.serviceTypes.length === 0) {
      return res.status(404).json(errorResponse(404, 'Service type not found on this profile'));
    }

    await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: {
        serviceTypes: {
          disconnect: { id: serviceTypeId },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Service type removed successfully',
      data: null,
    });
  } catch (error) {
    console.error('Error removing service type:', error);
    return res.status(500).json(errorResponse(500, 'Failed to remove service type'));
  }
};

/**
 * POST /api/workers/me/resume/parse
 * Runs (or re-runs, with { force: true }) AI resume parsing against the
 * worker's already-uploaded resume PDF and persists the result. Returns the
 * cached ResumeParseResult without re-calling the AI if one already exists
 * and force isn't set — resume-preview.tsx calls this on mount, so repeat
 * screen visits shouldn't burn an API call each time.
 */
export const parseMyResume = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const force = req.body?.force === true;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, resumeUrl: true, resumeParseResult: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    if (!workerProfile.resumeUrl) {
      return res.status(400).json(errorResponse(400, 'Upload a resume before requesting analysis'));
    }

    if (workerProfile.resumeParseResult && !force) {
      return res.status(200).json({
        success: true,
        message: 'Resume analysis retrieved successfully',
        data: workerProfile.resumeParseResult,
      });
    }

    const result = await parseWorkerResume(workerProfile.id, workerProfile.resumeUrl);

    return res.status(200).json({
      success: true,
      message: 'Resume analyzed successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error parsing resume:', error);
    return res.status(502).json(
      errorResponse(502, error instanceof Error ? error.message : 'Failed to analyze resume')
    );
  }
};

/**
 * GET /api/workers/me/packages
 * List the authenticated worker's own priced service packages (worker only)
 */
export const listMyPackages = async (req: AuthRequest, res: Response) => {
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

    const packages = await prisma.workerPackage.findMany({
      where: { workerProfileId: workerProfile.id },
      include: { serviceType: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Packages retrieved successfully',
      data: { packages },
    });
  } catch (error) {
    console.error('Error fetching packages:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch packages'));
  }
};

/**
 * POST /api/workers/me/packages
 * Create a priced package for one of the worker's own service categories
 * (worker only). serviceTypeId must already be connected to the worker via
 * the service-categories self-serve feature — a worker can't create a
 * package for a category they don't offer.
 */
export const createPackage = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { serviceTypeId, name, description, price } = req.body;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, serviceTypes: { where: { id: serviceTypeId }, select: { id: true } } },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    if (workerProfile.serviceTypes.length === 0) {
      return res.status(400).json(
        errorResponse(400, 'Add this service category to your profile before creating a package for it')
      );
    }

    const created = await prisma.workerPackage.create({
      data: {
        workerProfileId: workerProfile.id,
        serviceTypeId,
        name: name.trim(),
        description: typeof description === 'string' ? description.trim() : null,
        price,
      },
      include: { serviceType: { select: { id: true, name: true } } },
    });

    return res.status(201).json({
      success: true,
      message: 'Package created successfully',
      data: created,
    });
  } catch (error) {
    console.error('Error creating package:', error);
    return res.status(500).json(errorResponse(500, 'Failed to create package'));
  }
};

/**
 * PATCH /api/workers/me/packages/:packageId
 * Update a package's name/description/price/isActive/serviceTypeId (worker
 * only, ownership-checked).
 */
export const updatePackage = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const packageId = req.params.packageId as string;
    const { serviceTypeId, name, description, price, isActive } = req.body;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        id: true,
        serviceTypes: serviceTypeId ? { where: { id: serviceTypeId }, select: { id: true } } : false,
      },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const existing = await prisma.workerPackage.findFirst({
      where: { id: packageId, workerProfileId: workerProfile.id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Package not found on this profile'));
    }

    if (serviceTypeId !== undefined && (workerProfile.serviceTypes ?? []).length === 0) {
      return res.status(400).json(
        errorResponse(400, 'Add this service category to your profile before assigning a package to it')
      );
    }

    const updateData: any = {};
    if (serviceTypeId !== undefined) updateData.serviceTypeId = serviceTypeId;
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = typeof description === 'string' ? description.trim() : null;
    if (price !== undefined) updateData.price = price;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await prisma.workerPackage.update({
      where: { id: packageId },
      data: updateData,
      include: { serviceType: { select: { id: true, name: true } } },
    });

    return res.status(200).json({
      success: true,
      message: 'Package updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating package:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update package'));
  }
};

/**
 * DELETE /api/workers/me/packages/:packageId
 * Remove a package from the authenticated worker's profile (worker only,
 * ownership-checked). Historical bookings that included this package keep
 * their own BookingAddOn snapshot (name/price copied at booking time, no FK
 * back to WorkerPackage), so deleting it doesn't affect past bookings.
 */
export const deletePackage = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const packageId = req.params.packageId as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const existing = await prisma.workerPackage.findFirst({
      where: { id: packageId, workerProfileId: workerProfile.id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Package not found on this profile'));
    }

    await prisma.workerPackage.delete({ where: { id: packageId } });

    return res.status(200).json({
      success: true,
      message: 'Package removed successfully',
      data: null,
    });
  } catch (error) {
    console.error('Error deleting package:', error);
    return res.status(500).json(errorResponse(500, 'Failed to delete package'));
  }
};

/**
 * GET /api/workers/:workerId/packages
 * Public — a client browsing/booking a worker can see that worker's active
 * packages, optionally scoped to a specific service type (the one selected
 * earlier in the booking flow).
 */
export const getWorkerPackages = async (req: Request, res: Response) => {
  try {
    const workerId = req.params.workerId as string;
    const serviceTypeId = typeof req.query.serviceTypeId === 'string' ? req.query.serviceTypeId : undefined;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { id: true, kycStatus: true },
    });

    if (!workerProfile || workerProfile.kycStatus !== 'APPROVED') {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const packages = await prisma.workerPackage.findMany({
      where: {
        workerProfileId: workerProfile.id,
        isActive: true,
        ...(serviceTypeId ? { serviceTypeId } : {}),
      },
      include: { serviceType: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Packages retrieved successfully',
      data: { packages },
    });
  } catch (error) {
    console.error('Error fetching worker packages:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch packages'));
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
 * PATCH /api/workers/me/skills/:skillId
 * Update a skill on the authenticated worker's profile (worker only)
 */
export const updateSkill = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const skillId = req.params.skillId as string;
    const { name, category, rate } = req.body;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const existingSkill = await prisma.skill.findUnique({ where: { id: skillId } });
    if (!existingSkill || existingSkill.workerProfileId !== workerProfile.id) {
      return res.status(404).json(errorResponse(404, 'Skill not found'));
    }

    const skill = await prisma.skill.update({
      where: { id: skillId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(category !== undefined && { category: category.trim() }),
        ...(rate !== undefined && { rate }),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Skill updated successfully',
      data: { skill },
    });
  } catch (error) {
    console.error('Error updating skill:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update skill'));
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
 * PATCH /api/workers/me/certifications/:certId
 * Update an existing certification belonging to the authenticated worker
 * (worker only). Editing resets verificationStatus back to PENDING since the
 * content changed and needs re-review, clearing any prior rejection.
 */
export const updateCertification = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const certId = req.params.certId as string;
    const { name, issuer, issueDate, expiryDate, documentUrl } = req.body;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const existing = await prisma.certification.findUnique({ where: { id: certId } });
    if (!existing || existing.workerProfileId !== workerProfile.id) {
      return res.status(404).json(errorResponse(404, 'Certification not found'));
    }

    const certification = await prisma.certification.update({
      where: { id: certId },
      data: {
        title: name.trim(),
        issuer: issuer.trim(),
        issueDate: new Date(issueDate),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        documentUrl: documentUrl ?? existing.documentUrl,
        verificationStatus: 'PENDING',
        rejectionReason: null,
        reviewedAt: null,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Certification updated successfully',
      data: { certification: formatCertification(certification) },
    });
  } catch (error) {
    console.error('Error updating certification:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update certification'));
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

/**
 * GET /api/workers/me/availability-slots?date=YYYY-MM-DD&timeSlot=MORNING
 * Fine-grained per-date/per-timeSlot availability (worker only). Distinct
 * from PATCH /me/availability (coarse isAvailable + weekly availableDays
 * toggle) and from the public GET /:workerId/availability (booked-time
 * lookup for the client calendar) — this manages the WorkerAvailability
 * table directly.
 */
export const getMyAvailabilitySlots = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { date, timeSlot } = req.query;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const where: { workerProfileId: string; date?: Date; timeSlot?: TimeSlot } = {
      workerProfileId: workerProfile.id,
    };

    if (date !== undefined) {
      if (typeof date !== 'string' || isNaN(new Date(date).getTime())) {
        return res.status(400).json(errorResponse(400, 'date must be a valid YYYY-MM-DD date'));
      }
      where.date = toDayStart(date);
    }

    if (timeSlot !== undefined) {
      if (typeof timeSlot !== 'string' || !VALID_TIME_SLOTS.includes(timeSlot as TimeSlot)) {
        return res.status(400).json(errorResponse(400, `timeSlot must be one of ${VALID_TIME_SLOTS.join(', ')}`));
      }
      where.timeSlot = timeSlot as TimeSlot;
    }

    const slots = await prisma.workerAvailability.findMany({
      where,
      orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
    });

    return res.status(200).json({
      success: true,
      message: 'Availability slots retrieved successfully',
      data: { slots },
    });
  } catch (error) {
    console.error('Error fetching availability slots:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch availability slots'));
  }
};

/**
 * PATCH /api/workers/me/availability-slots
 * Body: { slots: [{ date, timeSlot }] }
 *
 * Replaces the worker's open slots for every date present in the request:
 * requested (date, timeSlot) pairs are opened (created or un-blocked), and
 * any existing open slot on those same dates that isn't in the new list is
 * closed (isBlocked = true) — unless it's currently isBooked, in which case
 * the whole request is rejected with a 409 (a worker can't close a slot out
 * from under an active booking). Dates not mentioned in the request are left
 * untouched. Max 2 slots per day.
 */
export const updateAvailabilitySlots = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { slots, dates } = req.body as {
      slots: Array<{ date: string; timeSlot: TimeSlot }>;
      // Optional — full set of dates being managed in this request. A date
      // listed here with no matching entries in `slots` has ALL of its open
      // slots closed (this is how a worker clears an entire day down to
      // zero slots, which `slots` alone can't express since an empty day
      // just wouldn't appear in it).
      dates?: string[];
    };

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const byDay = new Map<string, Set<TimeSlot>>();
    for (const slot of slots) {
      const dayIso = toDayStart(slot.date).toISOString();
      if (!byDay.has(dayIso)) byDay.set(dayIso, new Set());
      byDay.get(dayIso)!.add(slot.timeSlot);
    }
    // Register fully-cleared days (present in `dates`, absent from `slots`)
    // with an empty set so the close-loop below still runs for them.
    for (const date of dates ?? []) {
      const dayIso = toDayStart(date).toISOString();
      if (!byDay.has(dayIso)) byDay.set(dayIso, new Set());
    }

    const { maxSlotsPerDay } = await getAppSettings();
    for (const [dayIso, timeSlots] of byDay) {
      if (timeSlots.size > maxSlotsPerDay) {
        return res.status(400).json(
          errorResponse(400, `Cannot set more than ${maxSlotsPerDay} slots for ${dayIso.slice(0, 10)}`)
        );
      }
    }

    const updatedSlots = await prisma.$transaction(async (tx) => {
      const opened: Array<{ id: string; date: Date; timeSlot: TimeSlot }> = [];

      for (const [dayIso, timeSlots] of byDay) {
        const day = new Date(dayIso);

        const existing = await tx.workerAvailability.findMany({
          where: { workerProfileId: workerProfile.id, date: day },
        });

        for (const row of existing) {
          if (!timeSlots.has(row.timeSlot)) {
            if (row.isBooked) {
              throw new ActiveBookingConflictError(row.timeSlot, dayIso.slice(0, 10));
            }
            await tx.workerAvailability.update({ where: { id: row.id }, data: { isBlocked: true } });
          }
        }

        for (const timeSlot of timeSlots) {
          const row = await tx.workerAvailability.upsert({
            where: { workerProfileId_date_timeSlot: { workerProfileId: workerProfile.id, date: day, timeSlot } },
            create: { workerProfileId: workerProfile.id, date: day, timeSlot, isBlocked: false },
            update: { isBlocked: false },
          });
          opened.push(row);
        }
      }

      return opened;
    });

    return res.status(200).json({
      success: true,
      message: 'Availability slots updated successfully',
      data: { slots: updatedSlots },
    });
  } catch (error) {
    if (error instanceof ActiveBookingConflictError) {
      return res.status(409).json(
        errorResponse(409, `Cannot close ${error.timeSlot} on ${error.date} — it has an active booking`)
      );
    }
    console.error('Error updating availability slots:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update availability slots'));
  }
};

class ActiveBookingConflictError extends Error {
  constructor(public timeSlot: string, public date: string) {
    super(`Slot ${timeSlot} on ${date} has an active booking`);
  }
}

/**
 * PATCH /api/workers/me/rate
 * Body: { hourlyRate: number } — enforced range $20-$100/hr (worker only)
 */
export const updateHourlyRate = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { hourlyRate } = req.body as { hourlyRate: number };

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: { hourlyRate },
      select: { hourlyRate: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Hourly rate updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating hourly rate:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update hourly rate'));
  }
};