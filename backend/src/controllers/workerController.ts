import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { toOwnedStoredUrl } from '@utils/storageUrls';
import { parseWorkerBirthDate } from '@utils/age';
import { decryptField, decryptOptionalField, encryptOptionalField, maskLastFour } from '@utils/fieldEncryption';
import { maskProfanity } from '@utils/profanityFilter';
import {
  toDayStart,
  isoDay,
  addDays,
  phTodayStart,
  isRushDate,
  availableOnDateWhere,
  getWorkerCalendar,
  MAX_BOOKING_DAYS_AHEAD,
} from '@services/workerAvailabilityService';
import { getAppSettings } from '@services/appSettingsService';
import { parseWorkerResume } from '@services/resumeParseService';
import { computeWorkerTier, tierMultiplier } from '@utils/workerTier';
import { computeJobPricing } from '@utils/pricing';
import { resolveDrivingDistancesKm } from '@services/googleDistanceService';
import { isPerUnitModel, offersTaskFilter } from '@services/taskPriceService';
import { getWorkerSetupStatus, workerSetupCompleteWhere } from '@services/workerSetupService';
import { comparePassword } from '@utils/passwordHash';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import { nameSimilarity } from '@utils/nameSimilarity';
import type { Prisma } from '@prisma/client';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

export const searchWorkers = async (req: AuthRequest, res: Response) => {
  try {
    const {
      serviceType,
      category,
      date,
      hasPets,
      serviceTaskId,
      lat,
      lng,
      minRating,
      maxPrice,
      workerId,
      page = '1',
      limit = '10',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));

    if (date !== undefined && (typeof date !== 'string' || isNaN(new Date(date).getTime()))) {
      return res.status(400).json(errorResponse(400, 'date must be a valid YYYY-MM-DD date'));
    }

    const serviceTypeName = typeof serviceType === 'string' ? serviceType : typeof category === 'string' ? category : undefined;
    const hasPetsBool = hasPets === 'true' || hasPets === '1';

    const serviceTask =
      typeof serviceTaskId === 'string' && serviceTaskId
        ? await prisma.serviceTask.findUnique({ where: { id: serviceTaskId } })
        : null;

    const whereClause: Prisma.WorkerProfileWhereInput = {
      isAvailable: true,
      kycStatus: 'APPROVED',
      debtHoldAt: null,
      AND: [workerSetupCompleteWhere()],
      ...(serviceTask ? offersTaskFilter(serviceTask.id) : {}),
    };

    if (typeof workerId === 'string' && workerId) {
      whereClause.userId = workerId;
    }

    const serviceTypeWhere: Prisma.ServiceTypeWhereInput = {};
    if (serviceTypeName) {
      serviceTypeWhere.name = { equals: serviceTypeName, mode: 'insensitive' };
    }
    if (maxPrice) {
      const price = parseFloat(maxPrice as string);
      if (!isNaN(price)) {
        serviceTypeWhere.basePrice = { lte: price };
      }
    }
    if (Object.keys(serviceTypeWhere).length > 0) {
      whereClause.serviceCategories = { some: { status: 'VERIFIED', serviceType: serviceTypeWhere } };
    }

    if (minRating) {
      const rating = parseFloat(minRating as string);
      if (!isNaN(rating)) whereClause.rating = { gte: rating };
    }

    if (hasPetsBool) {
      whereClause.acceptsPets = true;
    }

    const isRush = typeof date === 'string' && isRushDate(date);
    if (typeof date === 'string') {
      (whereClause.AND as Prisma.WorkerProfileWhereInput[]).push(availableOnDateWhere(date));
    }

    const candidates = await prisma.workerProfile.findMany({
      where: whereClause,
      include: {
        user: { select: { id: true, fullName: true, avatar: true } },
        serviceCategories: {
          where: { status: 'VERIFIED' },
          include: {
            serviceType: {
              include: {
                tasks: { where: { isActive: true }, select: { id: true, basePrice: true, pricingModel: true } },
              },
            },
          },
        },
      },
      take: 500,
    });

    const filtered = candidates;

    filtered.sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.totalReviews - a.totalReviews;
    });

    const total = filtered.length;
    const start = (pageNum - 1) * limitNum;
    const page_ = filtered.slice(start, start + limitNum);

    const clientLat = typeof lat === 'string' ? parseFloat(lat) : NaN;
    const clientLng = typeof lng === 'string' ? parseFloat(lng) : NaN;
    const hasClientLocation = !isNaN(clientLat) && !isNaN(clientLng);

    const workersWithAddress = hasClientLocation
      ? page_.filter((w) => w.addressLat != null && w.addressLng != null)
      : [];

    const [tierSettings, completedCounts, workerDistancesKm] = await Promise.all([
      getAppSettings(),
      prisma.booking.groupBy({
        by: ['workerId'],
        where: { workerId: { in: page_.map((w) => w.userId) }, status: 'COMPLETED' },
        _count: { _all: true },
      }),
      resolveDrivingDistancesKm(
        { lat: clientLat, lng: clientLng },
        workersWithAddress.map((w) => ({ lat: w.addressLat!, lng: w.addressLng! }))
      ),
    ]);
    const completedByWorkerId = new Map(completedCounts.map((c) => [c.workerId as string, c._count._all]));
    const distanceKmByWorkerId = new Map(
      workersWithAddress.map((w, i) => [w.id, workerDistancesKm[i]])
    );

    const allTaskIds = Array.from(
      new Set(page_.flatMap((w) => w.serviceCategories.flatMap((c) => c.serviceType.tasks.map((t) => t.id))))
    );
    const workerTaskSelections = allTaskIds.length
      ? await prisma.workerTaskSelection.findMany({
          where: { workerProfileId: { in: page_.map((w) => w.id) }, serviceTaskId: { in: allTaskIds }, isActive: true },
        })
      : [];
    const selectedTaskIdsByWorker = new Map<string, Set<string>>();
    for (const sel of workerTaskSelections) {
      if (!selectedTaskIdsByWorker.has(sel.workerProfileId)) {
        selectedTaskIdsByWorker.set(sel.workerProfileId, new Set());
      }
      selectedTaskIdsByWorker.get(sel.workerProfileId)!.add(sel.serviceTaskId);
    }

    const cards = page_.map((worker) => {
      const categories = worker.serviceCategories.map((c) => c.serviceType);
      const matchedServiceType =
        categories.find((st) => serviceTypeName && st.name.toLowerCase() === serviceTypeName.toLowerCase()) ??
        categories[0];
      const selectedTaskIds = selectedTaskIdsByWorker.get(worker.id) ?? new Set<string>();

      const perUnitTask = !!serviceTask && isPerUnitModel(serviceTask.pricingModel);
      const basePrice = !serviceTask ? matchedServiceType?.basePrice ?? null : perUnitTask ? null : serviceTask.basePrice;
      const unitPriceForTask = perUnitTask ? serviceTask!.basePrice : null;

      const badges: string[] = ['VERIFIED'];
      if (worker.rating >= 4.8 && worker.totalReviews >= 20) badges.push('TOP_RATED');
      if (worker.totalReviews === 0) badges.push('NEW');

      const completedJobs = completedByWorkerId.get(worker.userId) ?? 0;
      const tier = computeWorkerTier(
        { rating: worker.rating, completedJobs, yearsExperience: worker.yearsExperience },
        tierSettings
      );
      if (tier === 'PRO') badges.push('PRO_TIER');
      if (tier === 'EXPERT') badges.push('EXPERT_TIER');

      const multiplier = tierMultiplier(tier, tierSettings);
      const workerDistanceKm = distanceKmByWorkerId.get(worker.id) ?? null;
      const jobPricing =
        basePrice != null && unitPriceForTask == null
          ? computeJobPricing({
              basePrice,
              tierMultiplier: multiplier,
              rushFeeRate: isRush ? tierSettings.rushFeeRate : 0,
              distanceKm: workerDistanceKm,
              freeDistanceKm: tierSettings.freeDistanceKm,
              perKmFee: tierSettings.perKmFee,
            })
          : null;
      const estimatedTotal = jobPricing?.estimatedPrice ?? null;

      const matchedTaskPrices = (matchedServiceType?.tasks ?? [])
        .filter((t) => selectedTaskIds.has(t.id) && t.basePrice > 0)
        .map((t) => t.basePrice);
      if (matchedTaskPrices.length === 0 && basePrice != null) matchedTaskPrices.push(basePrice);
      const priceRangeMin = matchedTaskPrices.length ? Math.round(Math.min(...matchedTaskPrices) * multiplier) : null;
      const priceRangeMax = matchedTaskPrices.length ? Math.round(Math.max(...matchedTaskPrices) * multiplier) : null;

      return {
        id: worker.userId,
        fullName: worker.user.fullName,
        avatar: worker.user.avatar,
        rating: worker.rating,
        totalReviews: worker.totalReviews,
        estimatedTotal,
        priceBreakdown: jobPricing
          ? {
              basePrice: jobPricing.basePrice,
              distanceFee: jobPricing.distanceFee,
              tierFee: jobPricing.tierFee,
              rushFee: jobPricing.rushFee,
            }
          : null,
        unitPrice:
          unitPriceForTask != null
            ? Math.round(unitPriceForTask * (multiplier + (isRush ? tierSettings.rushFeeRate : 0)) * 100) / 100
            : null,
        rushFeeRate: isRush ? tierSettings.rushFeeRate : 0,
        yearsExperience: worker.yearsExperience,
        priceRangeMin,
        priceRangeMax,
        tier,
        matchedServiceTypeId: matchedServiceType?.id ?? null,
        service: matchedServiceType?.name ?? 'General service',
        serviceTypeNames: categories.map((st) => st.name),
        activeJobCount: worker.activeJobCount,
        badges,
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
        city: true,
        state: true,
        kycStatus: true,
        kycSubmittedAt: true,
        kycApprovedAt: true,
        yearsExperience: true,
        user: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
          },
        },
        serviceCategories: {
          where: { status: 'VERIFIED' },
          select: {
            serviceType: {
              select: {
                id: true,
                name: true,
                basePrice: true,
                tasks: { where: { isActive: true }, select: { id: true, basePrice: true, pricingModel: true } },
              },
            },
          },
        },
        _count: { select: { reviews: true } },
        certifications: {
          where: { verificationStatus: 'APPROVED', visibleToClients: true },
        },
        resumeParseResult: {
          select: {
            parsedSkills: true,
            yearsOfExperience: true,
            masteryLevel: true,
            tradeCategory: true,
            summary: true,
          },
        },
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
    const tier = computeWorkerTier(
      { rating: worker.rating, completedJobs, yearsExperience: worker.yearsExperience },
      tierSettings
    );
    const multiplier = tierMultiplier(tier, tierSettings);

    const categories = worker.serviceCategories.map((c) => c.serviceType);
    const allTaskIds = categories.flatMap((st) => st.tasks.map((t) => t.id));
    const workerTaskSelections = allTaskIds.length
      ? await prisma.workerTaskSelection.findMany({
          where: { workerProfileId: worker.id, serviceTaskId: { in: allTaskIds }, isActive: true },
        })
      : [];
    const selectedTaskIds = new Set(workerTaskSelections.map((s) => s.serviceTaskId));

    const services = categories.map((st) => {
      const pricedTasks = st.tasks.filter((t) => selectedTaskIds.has(t.id) && t.basePrice > 0);
      const taskPrices = pricedTasks.length ? pricedTasks.map((t) => t.basePrice) : [st.basePrice];
      return {
        id: st.id,
        name: st.name,
        basePrice: st.basePrice,
        priceRangeMin: Math.round(Math.min(...taskPrices) * multiplier),
        priceRangeMax: Math.round(Math.max(...taskPrices) * multiplier),
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Worker details retrieved successfully',
      data: {
        id: worker.userId,
        name: worker.user.fullName,
        avatar: worker.user.avatar,
        bio: worker.bio,
        rating: worker.rating,
        tier,
        yearsExperience: worker.yearsExperience,
        completedJobs,
        serviceAreaRadius: worker.serviceAreaRadius,
        city: worker.city,
        state: worker.state,
        isAvailable: worker.isAvailable,
        availableDays: worker.availableDays,
        kycStatus: worker.kycStatus,
        kycSubmittedAt: worker.kycSubmittedAt,
        kycApprovedAt: worker.kycApprovedAt,
        // Nested relations matching Prisma schema
        resumeParseResult: worker.resumeParseResult,
        certifications: worker.certifications,
        services,
        priceRangeMin: services.length ? Math.min(...services.map((s) => s.priceRangeMin)) : null,
        priceRangeMax: services.length ? Math.max(...services.map((s) => s.priceRangeMax)) : null,
        verificationStatus: worker.kycStatus === 'APPROVED' ? 'VERIFIED' : 'PENDING',
        reviewCount: worker._count.reviews,
        activeJobCount: worker.activeJobCount,
      },
    });
  } catch (error) {
    console.error('Error fetching worker detail:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch worker details'));
  }
};

export const getMyDigitalId = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const worker = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        id: true,
        createdAt: true,
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
        memberSince: worker.createdAt,
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

export const getWorkerReviews = async (req: AuthRequest, res: Response) => {
  try {
    const workerId = req.params.workerId as string;
    const { page = '1', limit = '10' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const skip = (pageNum - 1) * limitNum;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { id: true, kycStatus: true },
    });

    if (!workerProfile || workerProfile.kycStatus !== 'APPROVED') {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { workerId: workerProfile.id, status: 'VISIBLE' },
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
      prisma.review.count({ where: { workerId: workerProfile.id, status: 'VISIBLE' } }),
    ]);

    const formattedReviews = reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: maskProfanity(review.comment),
      photoUrls: review.photoUrls,
      reviewer: {
        id: review.client.id,
        name: review.client.fullName,
        avatar: review.client.avatar,
      },
      serviceType: review.booking?.serviceTask?.name || 'Service',
      bookingId: review.booking?.id ?? null,
      workerResponse: maskProfanity(review.workerResponse),
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

export const respondToReview = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const reviewId = req.params.reviewId as string;
    const { response } = req.body as { response?: string };

    if (!response?.trim()) {
      return res.status(400).json(errorResponse(400, 'A response is required'));
    }
    if (response.trim().length > 1000) {
      return res.status(400).json(errorResponse(400, 'Response must be 1000 characters or fewer'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    if (!review || review.workerId !== workerProfile.id) {
      return res.status(404).json(errorResponse(404, 'Review not found'));
    }
    if (review.workerResponse != null) {
      return res.status(409).json(errorResponse(409, 'You have already responded to this review'));
    }

    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: { workerResponse: response.trim(), workerResponseAt: new Date() },
    });

    await notifyUser({
      userId: review.clientId,
      type: 'REVIEW_RESPONSE_ADDED',
      title: 'Your worker responded to your review',
      message: 'The worker you reviewed has posted a public response.',
      relatedId: review.bookingId,
    });

    return res.status(200).json({
      success: true,
      message: 'Response posted',
      data: { id: updated.id, workerResponse: updated.workerResponse, workerResponseAt: updated.workerResponseAt },
    });
  } catch (error) {
    console.error('Error responding to review:', error);
    return res.status(500).json(errorResponse(500, 'Failed to post response'));
  }
};

export const getWorkerAvailability = async (req: AuthRequest, res: Response) => {
  try {
    const workerId = req.params.workerId as string;
    const { date } = req.query;

    if (!date || typeof date !== 'string' || isNaN(new Date(date).getTime())) {
      return res.status(400).json(errorResponse(400, 'date query parameter is required'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { id: true, userId: true, kycStatus: true, availableDays: true },
    });

    if (!workerProfile || workerProfile.kycStatus !== 'APPROVED') {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const day = toDayStart(date);
    const [calendarDay] = await getWorkerCalendar(prisma, workerProfile, day, day);

    return res.status(200).json({
      success: true,
      message: 'Worker availability retrieved successfully',
      data: {
        available: calendarDay.available,
        occupied: calendarDay.jobs.map((j) => j.time),
      },
    });
  } catch (error) {
    console.error('Error fetching worker availability:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch worker availability'));
  }
};

export const getWorkerBlockedDates = async (req: AuthRequest, res: Response) => {
  try {
    const workerId = req.params.workerId as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { id: true, userId: true, kycStatus: true, availableDays: true },
    });

    if (!workerProfile || workerProfile.kycStatus !== 'APPROVED') {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const today = phTodayStart();
    const days = await getWorkerCalendar(prisma, workerProfile, today, addDays(today, MAX_BOOKING_DAYS_AHEAD));

    return res.status(200).json({
      success: true,
      message: 'Worker blocked dates retrieved successfully',
      data: { dates: days.filter((d) => !d.available).map((d) => d.date) },
    });
  } catch (error) {
    console.error('Error fetching worker blocked dates:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch worker blocked dates'));
  }
};

export const updateAvailability = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { isAvailable, availableDays } = req.body;

    if (isAvailable) {
      const current = await prisma.workerProfile.findUnique({
        where: { userId: req.user.userId },
        select: { debtHoldAt: true },
      });
      if (current?.debtHoldAt) {
        return res
          .status(402)
          .json(
            errorResponse(
              402,
              'Your account is on hold due to outstanding platform dues. Contact support to go available again.'
            )
          );
      }
    }

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
        birthDate: true,
        yearsExperience: true,
        availableDays: true,
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
      birthDate,
      yearsExperience,
    } = req.body;

    const updateData: any = {};
    if (birthDate !== undefined || yearsExperience !== undefined) {
      const current = await prisma.workerProfile.findUnique({
        where: { userId: req.user.userId },
        select: { kycStatus: true },
      });
      if (current?.kycStatus === 'APPROVED') {
        return res
          .status(409)
          .json(errorResponse(409, 'Your date of birth and experience were verified — contact support to change them'));
      }
    }
    if (birthDate !== undefined) {
      const parsed = parseWorkerBirthDate(birthDate, await getAppSettings());
      if ('error' in parsed) {
        return res.status(400).json(errorResponse(400, parsed.error));
      }
      updateData.birthDate = parsed.date;
    }
    if (yearsExperience !== undefined) {
      if (!Number.isInteger(yearsExperience) || yearsExperience < 0 || yearsExperience > 60) {
        return res.status(400).json(errorResponse(400, 'Years of experience must be a whole number from 0 to 60'));
      }
      updateData.yearsExperience = yearsExperience;
    }
    if (bio !== undefined) updateData.bio = bio;
    if (serviceAreaRadius !== undefined) updateData.serviceAreaRadius = serviceAreaRadius;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (zipCode !== undefined) updateData.zipCode = zipCode;
    if (addressLat !== undefined) updateData.addressLat = addressLat;
    if (addressLng !== undefined) updateData.addressLng = addressLng;
    if (resumeUrl !== undefined) {
      const storedResumeUrl = resumeUrl ? toOwnedStoredUrl(resumeUrl, req.user.userId) : resumeUrl;
      if (storedResumeUrl === null) {
        return res.status(400).json(errorResponse(400, 'That file does not belong to your account. Please upload it again.'));
      }
      updateData.resumeUrl = storedResumeUrl;
    }
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
        yearsExperience: updated.yearsExperience,
      },
    });
  } catch (error) {
    console.error('Error updating worker profile:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update profile'));
  }
};

type CertificationGateInput = {
  title?: string;
  issuer?: string;
  issueDate?: string;
  expiryDate?: string;
  documentUrl?: string;
};

type CategoryGateResult =
  | { category: Prisma.WorkerServiceCategoryGetPayload<{}> }
  | { error: string; status: number };

const MAX_REQUEST_DOCUMENTS = 5;

async function runCategoryGate(
  workerProfileId: string,
  serviceTypeId: string,
  input: { certificationId?: string; certifications?: CertificationGateInput[] }
): Promise<CategoryGateResult> {
  const targetServiceType = await prisma.serviceType.findUnique({ where: { id: serviceTypeId } });
  if (!targetServiceType || !targetServiceType.isActive) {
    return { error: 'Service type does not exist', status: 400 };
  }

  const existing = await prisma.workerServiceCategory.findUnique({
    where: { workerProfileId_serviceTypeId: { workerProfileId, serviceTypeId } },
  });
  if (existing && existing.status !== 'REJECTED') {
    return { category: existing };
  }

  const existingCount = await prisma.workerServiceCategory.count({
    where: { workerProfileId, status: { in: ['VERIFIED', 'PENDING_VERIFICATION'] } },
  });

  if (existingCount === 0 && !targetServiceType.requiresCertification) {
    const category = await prisma.workerServiceCategory.upsert({
      where: { workerProfileId_serviceTypeId: { workerProfileId, serviceTypeId } },
      create: { workerProfileId, serviceTypeId, status: 'VERIFIED', verifiedAt: new Date() },
      update: { status: 'VERIFIED', verifiedAt: new Date(), rejectedAt: null },
    });
    return { category };
  }

  const approvedCert = await prisma.certification.findFirst({
    where: { workerProfileId, serviceTypeId, verificationStatus: 'APPROVED' },
  });
  if (approvedCert) {
    const category = await prisma.workerServiceCategory.upsert({
      where: { workerProfileId_serviceTypeId: { workerProfileId, serviceTypeId } },
      create: { workerProfileId, serviceTypeId, status: 'VERIFIED', gatingCertificationId: approvedCert.id, verifiedAt: new Date() },
      update: { status: 'VERIFIED', gatingCertificationId: approvedCert.id, verifiedAt: new Date(), rejectedAt: null },
    });
    return { category };
  }

  const newDocs = input.certifications ?? [];
  if (newDocs.length > MAX_REQUEST_DOCUMENTS) {
    return { error: `Attach at most ${MAX_REQUEST_DOCUMENTS} documents.`, status: 400 };
  }
  for (const doc of newDocs) {
    if (!doc.title?.trim() || !doc.issuer?.trim() || !doc.issueDate || !doc.documentUrl) {
      return { error: 'Every document needs a title, issuer, issue date and file.', status: 400 };
    }
    if (isNaN(new Date(doc.issueDate).getTime()) || (doc.expiryDate && isNaN(new Date(doc.expiryDate).getTime()))) {
      return { error: 'Document dates must be valid dates.', status: 400 };
    }
  }
  if (newDocs.length > 0) {
    const owner = await prisma.workerProfile.findUnique({ where: { id: workerProfileId }, select: { userId: true } });
    for (const doc of newDocs) {
      const storedDocumentUrl = owner ? toOwnedStoredUrl(doc.documentUrl!, owner.userId) : null;
      if (!storedDocumentUrl) {
        return { error: 'That file does not belong to your account. Please upload it again.', status: 400 };
      }
      doc.documentUrl = storedDocumentUrl;
    }
  }

  const pendingCert = input.certificationId
    ? await prisma.certification.findFirst({
        where: { id: input.certificationId, workerProfileId, serviceTypeId, verificationStatus: 'PENDING' },
      })
    : newDocs.length === 0
      ? await prisma.certification.findFirst({
          where: { workerProfileId, serviceTypeId, verificationStatus: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        })
      : null;

  if (!pendingCert && newDocs.length === 0 && targetServiceType.requiresCertification) {
    return {
      error: `"${targetServiceType.name}" requires a certificate or license. Attach at least one.`,
      status: 400,
    };
  }

  const category = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const doc of newDocs) {
      created.push(
        await tx.certification.create({
          data: {
            workerProfileId,
            serviceTypeId,
            title: doc.title!.trim(),
            issuer: doc.issuer!.trim(),
            issueDate: new Date(doc.issueDate!),
            expiryDate: doc.expiryDate ? new Date(doc.expiryDate) : null,
            documentUrl: doc.documentUrl!,
            verificationStatus: 'PENDING',
          },
        })
      );
    }
    const gatingId = (pendingCert ?? created[0])?.id ?? null;

    return tx.workerServiceCategory.upsert({
      where: { workerProfileId_serviceTypeId: { workerProfileId, serviceTypeId } },
      create: { workerProfileId, serviceTypeId, status: 'PENDING_VERIFICATION', gatingCertificationId: gatingId },
      update: { status: 'PENDING_VERIFICATION', gatingCertificationId: gatingId, verifiedAt: null, rejectedAt: null },
    });
  });

  return { category };
}

export const addServiceCategory = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { serviceTypeId, certificationId, certification, certifications } = req.body as {
      serviceTypeId?: string;
      certificationId?: string;
      certification?: CertificationGateInput;
      certifications?: CertificationGateInput[];
    };

    if (typeof serviceTypeId !== 'string' || !serviceTypeId) {
      return res.status(400).json(errorResponse(400, 'serviceTypeId is required'));
    }
    if (certifications !== undefined && !Array.isArray(certifications)) {
      return res.status(400).json(errorResponse(400, 'certifications must be a list'));
    }
    const docs = [...(certifications ?? []), ...(certification ? [certification] : [])];

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const result = await runCategoryGate(workerProfile.id, serviceTypeId, { certificationId, certifications: docs });
    if ('error' in result) {
      return res.status(result.status).json(errorResponse(result.status, result.error));
    }

    return res.status(201).json({
      success: true,
      message: result.category.status === 'VERIFIED' ? 'Service category added' : 'Category submitted for admin review',
      data: { serviceCategory: result.category },
    });
  } catch (error) {
    console.error('Error adding service category:', error);
    return res.status(500).json(errorResponse(500, 'Failed to add service category'));
  }
};

export const listMyServiceTypes = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        serviceCategories: { include: { serviceType: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    return res.status(200).json({
      success: true,
      message: 'Service categories retrieved successfully',
      data: { serviceCategories: workerProfile.serviceCategories },
    });
  } catch (error) {
    console.error('Error fetching service categories:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch service categories'));
  }
};

export const removeServiceType = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const serviceTypeId = req.params.serviceTypeId as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const existing = await prisma.workerServiceCategory.findUnique({
      where: { workerProfileId_serviceTypeId: { workerProfileId: workerProfile.id, serviceTypeId } },
    });

    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Service category not found on this profile'));
    }

    const tasks = await prisma.serviceTask.findMany({ where: { serviceTypeId }, select: { id: true } });
    const taskIds = tasks.map((t) => t.id);

    await prisma.$transaction([
      prisma.workerTaskSelection.updateMany({
        where: { workerProfileId: workerProfile.id, serviceTaskId: { in: taskIds } },
        data: { isActive: false },
      }),
      prisma.workerServiceCategory.delete({ where: { id: existing.id } }),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Service category removed successfully',
      data: null,
    });
  } catch (error) {
    console.error('Error removing service category:', error);
    return res.status(500).json(errorResponse(500, 'Failed to remove service category'));
  }
};

export const selectTask = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const serviceTaskId = req.params.serviceTaskId as string;

    const task = await prisma.serviceTask.findUnique({ where: { id: serviceTaskId } });
    if (!task || !task.isActive) {
      return res.status(404).json(errorResponse(404, 'Task not found'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const category = await prisma.workerServiceCategory.findUnique({
      where: { workerProfileId_serviceTypeId: { workerProfileId: workerProfile.id, serviceTypeId: task.serviceTypeId } },
    });
    if (category?.status !== 'VERIFIED') {
      return res.status(403).json(
        errorResponse(403, 'You can pick tasks in this service once an admin approves your request for it.')
      );
    }

    const selection = await prisma.workerTaskSelection.upsert({
      where: { workerProfileId_serviceTaskId: { workerProfileId: workerProfile.id, serviceTaskId } },
      create: { workerProfileId: workerProfile.id, serviceTaskId, isActive: true },
      update: { isActive: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Task selected',
      data: { taskSelection: selection, category },
    });
  } catch (error) {
    console.error('Error selecting task:', error);
    return res.status(500).json(errorResponse(500, 'Failed to select task'));
  }
};

export const deselectTask = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const serviceTaskId = req.params.serviceTaskId as string;

    const task = await prisma.serviceTask.findUnique({
      where: { id: serviceTaskId },
      select: { id: true, serviceTypeId: true },
    });
    if (!task) {
      return res.status(404).json(errorResponse(404, 'Task not found'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const existing = await prisma.workerTaskSelection.findUnique({
      where: { workerProfileId_serviceTaskId: { workerProfileId: workerProfile.id, serviceTaskId } },
    });
    if (!existing || !existing.isActive) {
      return res.status(404).json(errorResponse(404, 'Task not selected on this profile'));
    }

    await prisma.workerTaskSelection.update({ where: { id: existing.id }, data: { isActive: false } });

    return res.status(200).json({ success: true, message: 'Task deselected', data: null });
  } catch (error) {
    console.error('Error deselecting task:', error);
    return res.status(500).json(errorResponse(500, 'Failed to deselect task'));
  }
};

export const getMyTaskCatalog = async (req: AuthRequest, res: Response) => {
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

    const [serviceTypes, myCategories, mySelections] = await Promise.all([
      prisma.serviceType.findMany({
        where: { isActive: true },
        include: { tasks: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
        orderBy: { name: 'asc' },
      }),
      prisma.workerServiceCategory.findMany({
        where: { workerProfileId: workerProfile.id },
        include: { gatingCertification: { select: { rejectionReason: true } } },
      }),
      prisma.workerTaskSelection.findMany({ where: { workerProfileId: workerProfile.id } }),
    ]);

    const categoryByTypeId = new Map(myCategories.map((c) => [c.serviceTypeId, c]));
    const selectionByTaskId = new Map(mySelections.map((s) => [s.serviceTaskId, s]));

    const categories = serviceTypes.map((st) => {
      const myCategory = categoryByTypeId.get(st.id) ?? null;
      return {
        serviceType: {
          id: st.id,
          name: st.name,
          description: st.description,
          icon: st.icon,
          requiresCertification: st.requiresCertification,
        },
        categoryStatus: myCategory?.status ?? null,
        gatingCertificationId: myCategory?.gatingCertificationId ?? null,
        rejectionReason:
          myCategory?.status === 'REJECTED' ? myCategory.gatingCertification?.rejectionReason ?? null : null,
        requestedAt: myCategory?.createdAt ?? null,
        tasks: st.tasks.map((task) => ({
          task: {
            id: task.id,
            name: task.name,
            description: task.description,
            pricingModel: task.pricingModel,
            price: task.basePrice > 0 ? task.basePrice : null,
            unitLabel: task.unitLabel,
          },
          mySelection: selectionByTaskId.get(task.id) ?? null,
        })),
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Task catalog retrieved successfully',
      data: { categories },
    });
  } catch (error) {
    console.error('Error fetching task catalog:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch task catalog'));
  }
};

export const getMySetupStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const status = await getWorkerSetupStatus(req.user.userId);
    if (!status) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }
    return res.status(200).json({ success: true, message: 'Setup status retrieved', data: status });
  } catch (error) {
    console.error('Error fetching setup status:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch setup status'));
  }
};

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

export const createPackage = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { serviceTypeId, name, description, price } = req.body;

    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return res.status(400).json(errorResponse(400, 'price must be a positive number'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        id: true,
        city: true,
        serviceCategories: {
          where: { serviceTypeId, status: 'VERIFIED' },
          select: { serviceType: { select: { id: true, name: true } } },
        },
      },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    if (workerProfile.serviceCategories.length === 0) {
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
        status: 'PENDING',
      },
      include: { serviceType: { select: { id: true, name: true } } },
    });

    return res.status(201).json({
      success: true,
      message: 'Package submitted for admin approval',
      data: created,
    });
  } catch (error) {
    console.error('Error creating package:', error);
    return res.status(500).json(errorResponse(500, 'Failed to create package'));
  }
};

export const updatePackage = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const packageId = req.params.packageId as string;
    const { serviceTypeId, name, description, price, isActive } = req.body;

    if (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price) || price <= 0)) {
      return res.status(400).json(errorResponse(400, 'price must be a positive number'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        id: true,
        city: true,
        serviceCategories: {
          where: { status: 'VERIFIED' },
          select: { serviceTypeId: true, serviceType: { select: { id: true, name: true } } },
        },
      },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const existing = await prisma.workerPackage.findFirst({
      where: { id: packageId, workerProfileId: workerProfile.id },
      select: { id: true, serviceType: { select: { name: true } } },
    });

    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Package not found on this profile'));
    }

    const targetCategory =
      serviceTypeId !== undefined
        ? workerProfile.serviceCategories.find((c) => c.serviceTypeId === serviceTypeId)
        : undefined;

    if (serviceTypeId !== undefined && !targetCategory) {
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
    if (serviceTypeId !== undefined || name !== undefined || description !== undefined || price !== undefined) {
      updateData.status = 'PENDING';
      updateData.rejectionReason = null;
      updateData.reviewedAt = null;
      updateData.reviewedById = null;
    }

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
        status: 'APPROVED',
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

const formatCertification = (cert: {
  id: string;
  title: string;
  issuer: string;
  issueDate: Date;
  expiryDate: Date | null;
  documentUrl: string;
  verificationStatus: string;
  rejectionReason: string | null;
  serviceTypeId?: string | null;
  visibleToClients: boolean;
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
    serviceTypeId: cert.serviceTypeId ?? null,
    visibleToClients: cert.visibleToClients,
  };
};

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

export const createCertification = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { name, issuer, issueDate, expiryDate, documentUrl, serviceTypeId, visibleToClients } = req.body as {
      name: string;
      issuer: string;
      issueDate: string;
      expiryDate?: string | null;
      documentUrl: string;
      serviceTypeId?: string | null;
      visibleToClients?: boolean;
    };

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    if (serviceTypeId) {
      const serviceTypeExists = await prisma.serviceType.findUnique({ where: { id: serviceTypeId }, select: { id: true } });
      if (!serviceTypeExists) {
        return res.status(400).json(errorResponse(400, 'serviceTypeId does not exist'));
      }
    }

    const storedDocumentUrl = toOwnedStoredUrl(documentUrl, req.user.userId);
    if (!storedDocumentUrl) {
      return res.status(400).json(errorResponse(400, 'That file does not belong to your account. Please upload it again.'));
    }

    const certification = await prisma.certification.create({
      data: {
        workerProfileId: workerProfile.id,
        title: name.trim(),
        issuer: issuer.trim(),
        issueDate: new Date(issueDate),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        documentUrl: storedDocumentUrl,
        serviceTypeId: serviceTypeId || null,
        ...(visibleToClients !== undefined ? { visibleToClients } : {}),
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

export const updateCertification = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const certId = req.params.certId as string;
    const { name, issuer, issueDate, expiryDate, documentUrl, serviceTypeId, visibleToClients } = req.body as {
      name: string;
      issuer: string;
      issueDate: string;
      expiryDate?: string | null;
      documentUrl?: string;
      serviceTypeId?: string | null;
      visibleToClients?: boolean;
    };

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

    if (serviceTypeId) {
      const serviceTypeExists = await prisma.serviceType.findUnique({ where: { id: serviceTypeId }, select: { id: true } });
      if (!serviceTypeExists) {
        return res.status(400).json(errorResponse(400, 'serviceTypeId does not exist'));
      }
    }

    const storedDocumentUrl = documentUrl ? toOwnedStoredUrl(documentUrl, req.user.userId) : undefined;
    if (storedDocumentUrl === null) {
      return res.status(400).json(errorResponse(400, 'That file does not belong to your account. Please upload it again.'));
    }

    const certification = await prisma.certification.update({
      where: { id: certId },
      data: {
        title: name.trim(),
        issuer: issuer.trim(),
        issueDate: new Date(issueDate),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        documentUrl: storedDocumentUrl ?? existing.documentUrl,
        serviceTypeId: serviceTypeId !== undefined ? serviceTypeId || null : existing.serviceTypeId,
        visibleToClients: visibleToClients !== undefined ? visibleToClients : existing.visibleToClients,
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

export const updateCertificationVisibility = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const certId = req.params.certId as string;
    const { visibleToClients } = req.body as { visibleToClients: boolean };

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
      data: { visibleToClients },
    });

    return res.status(200).json({
      success: true,
      message: 'Certification visibility updated',
      data: { certification: formatCertification(certification) },
    });
  } catch (error) {
    console.error('Error updating certification visibility:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update certification visibility'));
  }
};

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
      data: { ...worker, payoutAccountNumber: decryptOptionalField(worker.payoutAccountNumber) ?? null },
    });
  } catch (error) {
    console.error('Error fetching payout method:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch payout method'));
  }
};

const PAYOUT_NAME_MISMATCH_THRESHOLD = 0.34;

export const updatePayoutMethod = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { payoutMethod, payoutAccountName, payoutAccountNumber, password } = req.body;

    if (!password || typeof password !== 'string') {
      return res.status(400).json(errorResponse(400, 'Current password is required to change payout details'));
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, fullName: true, password: true },
    });
    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }
    const passwordValid = await comparePassword(password, user.password);
    if (!passwordValid) {
      return res.status(401).json(errorResponse(401, 'Incorrect password'));
    }

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: {
        payoutMethod,
        payoutAccountName: payoutAccountName ?? undefined,
        payoutAccountNumber: encryptOptionalField(payoutAccountNumber) ?? undefined,
      },
      select: {
        payoutMethod: true,
        payoutAccountName: true,
        payoutAccountNumber: true,
      },
    });

    await notifyUser({
      userId: user.id,
      type: 'PAYOUT_METHOD_CHANGED',
      title: 'Payout details changed',
      message: `Your payout method was updated to ${updated.payoutMethod} (${updated.payoutAccountNumber ? maskLastFour(decryptField(updated.payoutAccountNumber)) : 'no account number on file'}). If this wasn't you, contact support immediately.`,
    });

    if (updated.payoutAccountName && nameSimilarity(updated.payoutAccountName, user.fullName) < PAYOUT_NAME_MISMATCH_THRESHOLD) {
      await writeAuditLog({
        actorId: user.id,
        action: 'PAYOUT_NAME_MISMATCH',
        category: 'SYSTEM_ERROR',
        level: 'WARN',
        message: `Worker ${user.id} (${user.fullName}) set a payout account name that doesn't resemble their registered name: "${updated.payoutAccountName}"`,
        metadata: { workerId: user.id, registeredName: user.fullName, payoutAccountName: updated.payoutAccountName },
      });

      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
      await Promise.all(
        admins.map((admin) =>
          notifyUser({
            userId: admin.id,
            type: 'PAYOUT_NAME_MISMATCH',
            title: 'Payout name mismatch — review needed',
            message: `Worker ${user.fullName} set payout account name "${updated.payoutAccountName}", which doesn't resemble their registered name.`,
            relatedId: user.id,
          })
        )
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Payout method updated successfully',
      data: { ...updated, payoutAccountNumber: decryptOptionalField(updated.payoutAccountNumber) ?? null },
    });
  } catch (error) {
    console.error('Error updating payout method:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update payout method'));
  }
};

const MAX_CALENDAR_RANGE_DAYS = 93;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_RE.test(value) || isNaN(new Date(value).getTime())) return null;
  return toDayStart(value);
}

export const getMyCalendar = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const from = req.query.from !== undefined ? parseDay(req.query.from) : phTodayStart();
    const to = req.query.to !== undefined ? parseDay(req.query.to) : from ? addDays(from, 41) : null;
    if (!from || !to) {
      return res.status(400).json(errorResponse(400, 'from and to must be YYYY-MM-DD dates'));
    }
    if (to.getTime() < from.getTime() || addDays(from, MAX_CALENDAR_RANGE_DAYS).getTime() < to.getTime()) {
      return res.status(400).json(errorResponse(400, `The range must run forward and cover at most ${MAX_CALENDAR_RANGE_DAYS} days`));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, userId: true, availableDays: true, isAvailable: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const days = await getWorkerCalendar(prisma, workerProfile, from, to);

    return res.status(200).json({
      success: true,
      message: 'Calendar retrieved successfully',
      data: {
        availableDays: workerProfile.availableDays,
        isAvailable: workerProfile.isAvailable,
        today: isoDay(phTodayStart()),
        days,
      },
    });
  } catch (error) {
    console.error('Error fetching worker calendar:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch your calendar'));
  }
};

export const updateWeeklySchedule = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { availableDays } = req.body as { availableDays?: unknown };
    if (
      !Array.isArray(availableDays) ||
      !availableDays.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
    ) {
      return res.status(400).json(errorResponse(400, 'availableDays must be a list of weekdays 0 (Sun) to 6 (Sat)'));
    }
    const days = Array.from(new Set(availableDays as number[])).sort((a, b) => a - b);

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: { availableDays: days },
      select: { availableDays: true },
    });

    return res.status(200).json({ success: true, message: 'Weekly schedule saved', data: updated });
  } catch (error) {
    console.error('Error updating weekly schedule:', error);
    return res.status(500).json(errorResponse(500, 'Failed to save your weekly schedule'));
  }
};

export const updateDateOverrides = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { dates, isAvailable } = req.body as { dates?: unknown; isAvailable?: unknown };
    if (!Array.isArray(dates) || dates.length === 0 || dates.length > MAX_CALENDAR_RANGE_DAYS) {
      return res.status(400).json(errorResponse(400, `dates must list 1 to ${MAX_CALENDAR_RANGE_DAYS} dates`));
    }
    if (isAvailable !== null && typeof isAvailable !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'isAvailable must be true, false or null'));
    }
    const days: Date[] = [];
    for (const d of dates) {
      const day = parseDay(d);
      if (!day) return res.status(400).json(errorResponse(400, 'Every date must be YYYY-MM-DD'));
      days.push(day);
    }
    const today = phTodayStart();
    if (days.some((d) => d.getTime() < today.getTime())) {
      return res.status(400).json(errorResponse(400, "Past dates can't be changed"));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, userId: true, availableDays: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const closing = days.filter((d) =>
      isAvailable === false ? true : isAvailable === null ? !workerProfile.availableDays.includes(d.getUTCDay()) : false
    );
    if (closing.length > 0) {
      const conflicts = await prisma.booking.findMany({
        where: {
          workerId: workerProfile.userId,
          scheduledDate: { in: closing },
          status: { in: ['ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED'] },
        },
        select: { id: true, scheduledDate: true },
      });
      if (conflicts.length > 0) {
        const list = Array.from(new Set(conflicts.map((c) => isoDay(c.scheduledDate)))).join(', ');
        return res.status(409).json({
          ...errorResponse(409, `You have accepted jobs on ${list}. Reschedule or cancel them before closing ${conflicts.length === 1 ? 'that day' : 'those days'}.`),
          conflicts: conflicts.map((c) => ({ bookingId: c.id, date: isoDay(c.scheduledDate) })),
        });
      }
    }

    await prisma.$transaction(
      days.map((date) =>
        isAvailable === null
          ? prisma.workerDateOverride.deleteMany({ where: { workerProfileId: workerProfile.id, date } })
          : prisma.workerDateOverride.upsert({
              where: { workerProfileId_date: { workerProfileId: workerProfile.id, date } },
              create: { workerProfileId: workerProfile.id, date, isAvailable },
              update: { isAvailable },
            })
      )
    );

    return res.status(200).json({
      success: true,
      message: isAvailable === null ? 'Dates set back to your weekly schedule' : isAvailable ? 'Dates opened' : 'Dates closed',
      data: { dates: days.map(isoDay), isAvailable },
    });
  } catch (error) {
    console.error('Error updating date overrides:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update your calendar'));
  }
};
