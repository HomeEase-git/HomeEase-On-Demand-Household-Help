import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { toDayStart, materializeTemplateForWorker, setUnavailableRange } from '@services/workerAvailabilityService';
import { getAppSettings } from '@services/appSettingsService';
import { parseWorkerResume } from '@services/resumeParseService';
import { computeWorkerTier, tierMultiplier } from '@utils/workerTier';
import { computeJobPricing } from '@utils/pricing';
import { distanceKm } from '@utils/geo';
import { buildCapabilityFilters } from '@services/matchingService';
import { normalizeTin, maskTin } from '@utils/taxId';
import { getCertificateDownloadUrl } from '@services/taxCertificateService';
import { isPriceWithinTaskBounds } from '@services/taskPriceService';
import { VALID_TIME_SLOTS } from '@/constants/bookingEnums';
import type { TimeSlot, Prisma } from '@prisma/client';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * A task's effective price for range/preview purposes: the worker's own
 * WorkerTaskPrice when they've set one, falling back to the task's own
 * (admin-set) basePrice for a task they haven't priced yet — shared by
 * searchWorkers and getWorkerDetail so their category-range previews never
 * disagree on which number a given worker+task resolves to.
 */
function effectiveTaskPrice(
  task: { basePrice: number; pricingModel: string },
  workerPrice: { price: number | null; unitPrice: number | null } | undefined
): number {
  if (!workerPrice) return task.basePrice;
  const value = task.pricingModel === 'PER_UNIT' ? workerPrice.unitPrice : workerPrice.price;
  return value ?? task.basePrice;
}

/**
 * GET /api/workers
 * Worker discovery search (public). Query params:
 *   serviceType, date (YYYY-MM-DD), timeSlot, hasPets, scopeAnswers (JSON
 *   object string, keyed by ServiceScopeField.label), serviceTaskId,
 *   lat, lng, page, limit
 *   — plus legacy category/minRating/maxPrice, kept for existing callers.
 *
 * Filters to isAvailable + kycStatus APPROVED workers under capacity, with an
 * open (date, timeSlot) slot when both are given, offering serviceType, and
 * — via buildCapabilityFilters — matching whatever the client answered for
 * any usedForMatching scope field (see matchingService.ts's docblock on that
 * function; it's the same filter findAutoMatchWorker uses, so Step 3's list
 * and "surprise me" never disagree on eligibility). Sorted by rating —
 * there's no reliable worker location data to sort/filter by proximity (see
 * matchingService.ts for the same reasoning on auto-match).
 */
export const searchWorkers = async (req: AuthRequest, res: Response) => {
  try {
    const {
      serviceType,
      category,
      date,
      timeSlot,
      hasPets,
      scopeAnswers,
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

    if (timeSlot !== undefined && !VALID_TIME_SLOTS.includes(timeSlot as TimeSlot)) {
      return res.status(400).json(errorResponse(400, `timeSlot must be one of ${VALID_TIME_SLOTS.join(', ')}`));
    }
    if (date !== undefined && (typeof date !== 'string' || isNaN(new Date(date).getTime()))) {
      return res.status(400).json(errorResponse(400, 'date must be a valid YYYY-MM-DD date'));
    }

    let parsedScopeAnswers: Record<string, string | string[]> | undefined;
    if (typeof scopeAnswers === 'string' && scopeAnswers.trim()) {
      try {
        const parsed = JSON.parse(scopeAnswers);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parsedScopeAnswers = parsed;
      } catch {
        return res.status(400).json(errorResponse(400, 'scopeAnswers must be a JSON object'));
      }
    }

    const serviceTypeName = typeof serviceType === 'string' ? serviceType : typeof category === 'string' ? category : undefined;
    const hasPetsBool = hasPets === 'true' || hasPets === '1';

    const capabilityFilters = serviceTypeName
      ? await buildCapabilityFilters(serviceTypeName, parsedScopeAnswers)
      : [];

    // A specific task with a real price (FIXED/PER_UNIT) is only bookable
    // through a worker who's actually priced it — createBooking would 409 on
    // any other candidate. Excluded from results outright (not shown with a
    // null price) rather than left for the client to discover at checkout.
    // CUSTOM_QUOTE tasks have no WorkerTaskPrice at all, so they impose no filter.
    const serviceTask =
      typeof serviceTaskId === 'string' && serviceTaskId
        ? await prisma.serviceTask.findUnique({ where: { id: serviceTaskId } })
        : null;
    const requirePricedTaskId = serviceTask && serviceTask.pricingModel !== 'CUSTOM_QUOTE' ? serviceTask.id : null;

    const whereClause: Prisma.WorkerProfileWhereInput = {
      isAvailable: true,
      kycStatus: 'APPROVED',
      debtHoldAt: null,
      AND: capabilityFilters,
      ...(requirePricedTaskId
        ? { taskPrices: { some: { serviceTaskId: requirePricedTaskId, isActive: true } } }
        : {}),
    };

    // Scopes discovery to a single already-known worker — used by the client
    // app to check a specific (e.g. profile-locked) worker's real open slots
    // for a date, via the same authoritative WorkerAvailability filtering
    // below, rather than a separate bespoke endpoint.
    if (typeof workerId === 'string' && workerId) {
      whereClause.userId = workerId;
    }

    if (serviceTypeName) {
      // Exact match, not substring — a "contains" match here could pull in
      // an unrelated category whose name happens to include this one as a
      // substring (e.g. "Repair"), and it must agree with
      // matchingService.findAutoMatchWorker's equals check so Step 3's list
      // and auto-match never disagree on who's eligible.
      whereClause.serviceTypes = { some: { name: { equals: serviceTypeName, mode: 'insensitive' } } };
    }

    if (minRating) {
      const rating = parseFloat(minRating as string);
      if (!isNaN(rating)) whereClause.rating = { gte: rating };
    }

    if (maxPrice) {
      const price = parseFloat(maxPrice as string);
      if (!isNaN(price)) {
        whereClause.serviceTypes = {
          some: { ...(whereClause.serviceTypes as any)?.some, basePrice: { lte: price } },
        };
      }
    }

    if (hasPetsBool) {
      whereClause.acceptsPets = true;
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
        serviceTypes: {
          include: {
            tasks: { where: { isActive: true }, select: { id: true, basePrice: true, pricingModel: true } },
          },
        },
        availability: dayStart ? { where: { date: dayStart, isBlocked: false, isBooked: false } } : false,
      },
      // Bounded candidate pool — the rating sort below runs in memory (see
      // file header comment), so this caps how much a single request can
      // pull before that pass.
      take: 500,
    });

    const filtered = candidates.filter((w) => w.activeJobCount < w.maxConcurrentJobs);

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

    // Batched across the whole page (every task under every candidate's
    // service types), not just the one requested serviceTaskId — the
    // category-level price-range preview below needs each worker's own
    // priced value for every task in their matched category, not just one.
    const allTaskIds = Array.from(
      new Set(page_.flatMap((w) => w.serviceTypes.flatMap((st) => st.tasks.map((t) => t.id))))
    );
    const workerTaskPrices = allTaskIds.length
      ? await prisma.workerTaskPrice.findMany({
          where: { workerProfileId: { in: page_.map((w) => w.id) }, serviceTaskId: { in: allTaskIds }, isActive: true },
        })
      : [];
    const taskPriceByWorkerAndTask = new Map(
      workerTaskPrices.map((p) => [`${p.workerProfileId}:${p.serviceTaskId}`, p])
    );
    // Keeps the category-level browse list from going empty for a worker
    // still mid-setup (a specific-task search above is strict instead: such a
    // worker is excluded from results entirely via requirePricedTaskId).
    const effectiveTaskValue = (
      workerProfileId: string,
      task: { id: string; basePrice: number; pricingModel: string }
    ): number => effectiveTaskPrice(task, taskPriceByWorkerAndTask.get(`${workerProfileId}:${task.id}`));

    const cards = page_.map((worker) => {
      const matchedServiceType =
        worker.serviceTypes.find((st) => serviceTypeName && st.name.toLowerCase() === serviceTypeName.toLowerCase()) ??
        worker.serviceTypes[0];

      // requirePricedTaskId guarantees (via the DB filter above) that every
      // candidate here has an active WorkerTaskPrice for this exact task, so
      // effectiveTaskValue's task.basePrice fallback never actually triggers
      // for this specific lookup — only for the category-range preview below,
      // where a worker legitimately may not have priced every task yet.
      const basePrice = serviceTask
        ? effectiveTaskValue(worker.id, serviceTask)
        : matchedServiceType?.basePrice ?? null;
      // PER_UNIT has no meaningful total until a quantity is known (collected
      // later, in the booking form's scope-answer step) — expose the raw
      // rate instead so mobile can compute total × quantity client-side (see
      // bookingPriceEstimate.ts) rather than showing a misleading total here.
      const unitPriceForTask =
        serviceTask?.pricingModel === 'PER_UNIT'
          ? (taskPriceByWorkerAndTask.get(`${worker.id}:${serviceTask.id}`)?.unitPrice ?? null)
          : null;

      const badges: string[] = ['VERIFIED'];
      if (worker.rating >= 4.8 && worker.totalReviews >= 20) badges.push('TOP_RATED');
      if (worker.totalReviews === 0) badges.push('NEW');

      const completedJobs = completedByWorkerId.get(worker.userId) ?? 0;
      const tier = computeWorkerTier(worker.rating, completedJobs, tierSettings);
      if (tier === 'PRO') badges.push('PRO_TIER');
      if (tier === 'EXPERT') badges.push('EXPERT_TIER');

      // Same formula bookingController.createBooking uses for the real
      // charge (see utils/pricing.computeJobPricing) — this is a genuine
      // per-job preview, not a separate hourly-rate guess.
      const multiplier = tierMultiplier(tier, tierSettings);
      const workerDistanceKm =
        hasClientLocation && worker.addressLat != null && worker.addressLng != null
          ? distanceKm({ lat: clientLat, lng: clientLng }, { lat: worker.addressLat, lng: worker.addressLng })
          : null;
      const estimatedTotal =
        basePrice != null && unitPriceForTask == null
          ? computeJobPricing({
              basePrice,
              tierMultiplier: multiplier,
              distanceKm: workerDistanceKm,
            }).estimatedPrice
          : null;

      // Browse-time price range for this worker's matched category — the
      // spread across that category's tasks at THIS worker's own priced
      // values (falling back to the task's basePrice for one they haven't
      // priced yet), at THIS worker's own (already fixed) tier, not a flat
      // single number. Distance isn't factored in here (unlike estimatedTotal
      // above) since browsing lists don't scope to one client address/booking yet.
      const matchedTaskPrices = matchedServiceType?.tasks?.length
        ? matchedServiceType.tasks.map((t) => effectiveTaskValue(worker.id, t))
        : basePrice != null
          ? [basePrice]
          : [];
      const priceRangeMin = matchedTaskPrices.length ? Math.round(Math.min(...matchedTaskPrices) * multiplier) : null;
      const priceRangeMax = matchedTaskPrices.length ? Math.round(Math.max(...matchedTaskPrices) * multiplier) : null;

      return {
        id: worker.userId,
        fullName: worker.user.fullName,
        avatar: worker.user.avatar,
        rating: worker.rating,
        totalReviews: worker.totalReviews,
        estimatedTotal,
        // Only populated for a PER_UNIT task search — the tier-adjusted
        // per-unit rate, for mobile to multiply by quantity once the client
        // enters one (see bookingPriceEstimate.ts / Stage 4 of the task-
        // pricing plan). Null for every other pricing model.
        unitPrice: unitPriceForTask != null ? Math.round(unitPriceForTask * multiplier * 100) / 100 : null,
        priceRangeMin,
        priceRangeMax,
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
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatar: true,
          },
        },
        serviceTypes: {
          select: {
            id: true,
            name: true,
            basePrice: true,
            tasks: { where: { isActive: true }, select: { id: true, basePrice: true, pricingModel: true } },
          },
        },
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
    const multiplier = tierMultiplier(tier, tierSettings);

    const allTaskIds = worker.serviceTypes.flatMap((st) => st.tasks.map((t) => t.id));
    const workerTaskPrices = allTaskIds.length
      ? await prisma.workerTaskPrice.findMany({
          where: { workerProfileId: worker.id, serviceTaskId: { in: allTaskIds }, isActive: true },
        })
      : [];
    const taskPriceByTaskId = new Map(workerTaskPrices.map((p) => [p.serviceTaskId, p]));

    // Per-category price range at this worker's own priced values (falling
    // back to a task's basePrice for one they haven't priced yet), at this
    // worker's own (fixed) tier — mirrors serviceController's
    // marketplace-wide range but narrowed to just this one worker.
    const services = worker.serviceTypes.map((st) => {
      const taskPrices = st.tasks.length
        ? st.tasks.map((t) => effectiveTaskPrice(t, taskPriceByTaskId.get(t.id)))
        : [st.basePrice];
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
        kycStatus: worker.kycStatus,
        kycSubmittedAt: worker.kycSubmittedAt,
        kycApprovedAt: worker.kycApprovedAt,
        resumeUrl: worker.resumeUrl,
        // Nested relations matching Prisma schema
        resumeParseResult: worker.resumeParseResult,
        certifications: worker.certifications,
        services,
        // Aggregate across every category this worker offers — the overall
        // "range of what this worker offers" shown on their profile before
        // a specific category is picked.
        priceRangeMin: services.length ? Math.min(...services.map((s) => s.priceRangeMin)) : null,
        priceRangeMax: services.length ? Math.max(...services.map((s) => s.priceRangeMax)) : null,
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

    if (isAvailable) {
      const current = await prisma.workerProfile.findUnique({
        where: { userId: req.user.userId },
        select: { debtHoldAt: true },
      });
      if (current?.debtHoldAt) {
        // 402, not 403 — see the matching comment in bookingController's
        // acceptBooking (403 triggers the app's auth-clearing interceptor).
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
 * GET /api/workers/me/task-prices
 * Every ServiceTask under the worker's connected service categories,
 * annotated with the worker's own WorkerTaskPrice row if one exists — so the
 * mobile "Your Prices" screen can render admin bounds + current value (or a
 * "set your price" prompt) without a second round trip.
 */
export const listMyTaskPrices = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        id: true,
        serviceTypes: {
          select: {
            id: true,
            name: true,
            tasks: { where: { isActive: true }, orderBy: { name: 'asc' } },
          },
        },
      },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const allTasks = workerProfile.serviceTypes.flatMap((st) => st.tasks.map((t) => ({ ...t, serviceTypeName: st.name })));
    const myPrices = await prisma.workerTaskPrice.findMany({
      where: { workerProfileId: workerProfile.id, serviceTaskId: { in: allTasks.map((t) => t.id) } },
    });
    const priceByTaskId = new Map(myPrices.map((p) => [p.serviceTaskId, p]));

    const data = allTasks.map((task) => ({
      task: {
        id: task.id,
        name: task.name,
        serviceTypeName: task.serviceTypeName,
        pricingModel: task.pricingModel,
        minPrice: task.minPrice,
        maxPrice: task.maxPrice,
        unitLabel: task.unitLabel,
      },
      myPrice: priceByTaskId.get(task.id) ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: 'Task prices retrieved successfully',
      data: { taskPrices: data },
    });
  } catch (error) {
    console.error('Error fetching task prices:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch task prices'));
  }
};

/**
 * PUT /api/workers/me/task-prices/:serviceTaskId
 * Set (upsert) the worker's own price for one task — { price } for FIXED,
 * { unitPrice } for PER_UNIT. Ownership gate mirrors createPackage: the
 * worker must already offer the task's parent service category. Rejects
 * CUSTOM_QUOTE tasks outright — there's nothing to set, the worker quotes
 * on-site via submitQuote instead.
 */
export const setMyTaskPrice = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const serviceTaskId = req.params.serviceTaskId as string;
    const { price, unitPrice } = req.body as { price?: number; unitPrice?: number };

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, serviceTypes: { select: { id: true } } },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const task = await prisma.serviceTask.findUnique({ where: { id: serviceTaskId } });
    if (!task) {
      return res.status(404).json(errorResponse(404, 'Task not found'));
    }

    if (!workerProfile.serviceTypes.some((st) => st.id === task.serviceTypeId)) {
      return res.status(400).json(
        errorResponse(400, 'Add this service category to your profile before pricing this task')
      );
    }

    if (task.pricingModel === 'CUSTOM_QUOTE') {
      return res.status(400).json(errorResponse(400, 'This task is quoted on-site — there is no upfront price to set'));
    }

    const value = task.pricingModel === 'PER_UNIT' ? unitPrice : price;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return res.status(400).json(
        errorResponse(400, task.pricingModel === 'PER_UNIT' ? 'unitPrice is required' : 'price is required')
      );
    }
    if (!isPriceWithinTaskBounds(value, task)) {
      return res.status(400).json(
        errorResponse(400, `Must be between ₱${task.minPrice} and ₱${task.maxPrice}`)
      );
    }

    const record = await prisma.workerTaskPrice.upsert({
      where: { workerProfileId_serviceTaskId: { workerProfileId: workerProfile.id, serviceTaskId } },
      create: {
        workerProfileId: workerProfile.id,
        serviceTaskId,
        price: task.pricingModel === 'FIXED' ? value : null,
        unitPrice: task.pricingModel === 'PER_UNIT' ? value : null,
        isActive: true,
      },
      update: {
        price: task.pricingModel === 'FIXED' ? value : null,
        unitPrice: task.pricingModel === 'PER_UNIT' ? value : null,
        isActive: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Price saved successfully',
      data: record,
    });
  } catch (error) {
    console.error('Error setting task price:', error);
    return res.status(500).json(errorResponse(500, 'Failed to save price'));
  }
};

/**
 * DELETE /api/workers/me/task-prices/:serviceTaskId
 * Soft-disable rather than hard delete — matches WorkerPackage's convention,
 * and gives Stage 3's "excluded from search if unpriced" logic one clean
 * isActive check to make instead of also having to handle a missing row.
 */
export const deleteMyTaskPrice = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const serviceTaskId = req.params.serviceTaskId as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const existing = await prisma.workerTaskPrice.findUnique({
      where: { workerProfileId_serviceTaskId: { workerProfileId: workerProfile.id, serviceTaskId } },
    });

    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Price not found on this profile'));
    }

    await prisma.workerTaskPrice.update({ where: { id: existing.id }, data: { isActive: false } });

    return res.status(200).json({
      success: true,
      message: 'Price removed successfully',
      data: null,
    });
  } catch (error) {
    console.error('Error deleting task price:', error);
    return res.status(500).json(errorResponse(500, 'Failed to delete price'));
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
 * GET /api/workers/me/capabilities
 * List the authenticated worker's declared ServiceScopeFieldOption ids
 * (worker only) — replaces the old free-text Skill list. Nothing here is
 * typed by the worker; every id traces back to a real admin-defined option.
 */
export const listMyCapabilities = async (req: AuthRequest, res: Response) => {
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

    const capabilities = await prisma.workerScopeFieldCapability.findMany({
      where: { workerProfileId: workerProfile.id },
      select: { optionId: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Capabilities retrieved successfully',
      data: { optionIds: capabilities.map((c) => c.optionId) },
    });
  } catch (error) {
    console.error('Error fetching capabilities:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch capabilities'));
  }
};

/**
 * PUT /api/workers/me/capabilities
 * Body: { optionIds: string[] } — replace-all, same pattern
 * adminServiceTypeController.updateServiceType uses for scope fields
 * (delete-then-recreate in a transaction). Every id must be a real
 * ServiceScopeFieldOption belonging to a ServiceType this worker actually
 * offers — a worker can't declare a capability for a category they haven't
 * added.
 */
export const replaceMyCapabilities = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { optionIds } = req.body as { optionIds?: unknown };
    if (!Array.isArray(optionIds) || !optionIds.every((id) => typeof id === 'string')) {
      return res.status(400).json(errorResponse(400, 'optionIds must be an array of strings'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, serviceTypes: { select: { id: true } } },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const offeredServiceTypeIds = new Set(workerProfile.serviceTypes.map((s) => s.id));

    const uniqueOptionIds = Array.from(new Set(optionIds));
    if (uniqueOptionIds.length > 0) {
      const options = await prisma.serviceScopeFieldOption.findMany({
        where: { id: { in: uniqueOptionIds } },
        select: { id: true, field: { select: { serviceTypeId: true, usedForMatching: true } } },
      });
      if (options.length !== uniqueOptionIds.length) {
        return res.status(400).json(errorResponse(400, 'One or more options do not exist'));
      }
      const invalid = options.find(
        (o) => !o.field.usedForMatching || !offeredServiceTypeIds.has(o.field.serviceTypeId)
      );
      if (invalid) {
        return res
          .status(400)
          .json(errorResponse(400, 'One or more options are not available to declare a capability for'));
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.workerScopeFieldCapability.deleteMany({ where: { workerProfileId: workerProfile.id } });
      if (uniqueOptionIds.length > 0) {
        await tx.workerScopeFieldCapability.createMany({
          data: uniqueOptionIds.map((optionId) => ({ workerProfileId: workerProfile.id, optionId })),
        });
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Capabilities updated successfully',
      data: { optionIds: uniqueOptionIds },
    });
  } catch (error) {
    console.error('Error updating capabilities:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update capabilities'));
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
 * GET /api/workers/me/tax-info
 * Get the authenticated worker's TIN-on-file, masked (worker only). Masked
 * because this is echoed back to the same screen the worker just typed it
 * into — full plaintext isn't needed for a "yes I have one saved" check.
 */
export const getTaxInfo = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const worker = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { tin: true, tinVerifiedAt: true },
    });

    if (!worker) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    return res.status(200).json({
      success: true,
      message: 'Tax info retrieved successfully',
      data: {
        tinOnFile: !!worker.tin,
        maskedTin: worker.tin ? maskTin(worker.tin) : null,
        tinVerifiedAt: worker.tinVerifiedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching tax info:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch tax info'));
  }
};

/**
 * PATCH /api/workers/me/tax-info
 * Set the authenticated worker's TIN (worker only). Format validated by
 * validateUpdateTaxInfo before this runs. A worker's TIN is not required to
 * use the app — it's only required before a 2307 certificate can be
 * generated for them (see taxCertificateService.generateQuarterlyCertificates).
 */
export const updateTaxInfo = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { tin } = req.body as { tin: string };
    const normalized = normalizeTin(tin);

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: { tin: normalized, tinVerifiedAt: null },
      select: { tin: true, tinVerifiedAt: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Tax info updated successfully',
      data: { tinOnFile: true, maskedTin: maskTin(updated.tin!), tinVerifiedAt: updated.tinVerifiedAt },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json(errorResponse(409, 'This TIN is already on file for another worker'));
    }
    console.error('Error updating tax info:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update tax info'));
  }
};

/**
 * GET /api/workers/me/vat-registration
 * A worker is legally required to register for VAT once their gross annual
 * receipts cross BIR's threshold, regardless of trade — unrelated to TIN.
 * `vatRegistered` (the only field pricing logic reads) only ever flips true
 * via admin approval below, never from submission alone.
 */
export const getMyVatRegistration = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const worker = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: {
        vatRegistered: true,
        vatDocumentUrl: true,
        vatVerificationStatus: true,
        vatRejectionReason: true,
        vatSubmittedAt: true,
        vatReviewedAt: true,
      },
    });

    if (!worker) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    return res.status(200).json({
      success: true,
      message: 'VAT registration status retrieved successfully',
      data: worker,
    });
  } catch (error) {
    console.error('Error fetching VAT registration status:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch VAT registration status'));
  }
};

/**
 * POST /api/workers/me/vat-registration
 * Worker submits (or resubmits) proof of VAT registration — a document
 * already uploaded via POST /api/users/me/kyc-documents/upload with
 * documentType VAT_REGISTRATION. Moves to PENDING for admin review; does NOT
 * touch vatRegistered itself. Resubmission (e.g. after a rejection) simply
 * overwrites the previous claim and clears the old rejection reason.
 */
export const submitVatRegistration = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { documentUrl } = req.body as { documentUrl?: string };
    if (!documentUrl || typeof documentUrl !== 'string') {
      return res.status(400).json(errorResponse(400, 'documentUrl is required'));
    }

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: {
        vatDocumentUrl: documentUrl,
        vatVerificationStatus: 'PENDING',
        vatRejectionReason: null,
        vatSubmittedAt: new Date(),
        vatReviewedAt: null,
        vatReviewedById: null,
      },
      select: {
        vatRegistered: true,
        vatDocumentUrl: true,
        vatVerificationStatus: true,
        vatRejectionReason: true,
        vatSubmittedAt: true,
        vatReviewedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'VAT registration submitted for review',
      data: updated,
    });
  } catch (error) {
    console.error('Error submitting VAT registration:', error);
    return res.status(500).json(errorResponse(500, 'Failed to submit VAT registration'));
  }
};

/**
 * GET /api/workers/me/tax-certificates
 * Lists the authenticated worker's ISSUED Form 2307 certificates with a
 * fresh short-lived signed download URL per certificate (worker only). Draft
 * certificates (generated but not yet issued) are never returned here.
 */
export const getMyTaxCertificates = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const certificates = await prisma.taxCertificate.findMany({
      where: { workerId: req.user.userId, status: 'ISSUED' },
      orderBy: { periodStart: 'desc' },
    });

    const data = await Promise.all(
      certificates.map(async (cert) => ({
        id: cert.id,
        periodStart: cert.periodStart,
        periodEnd: cert.periodEnd,
        totalIncomePayments: cert.totalIncomePayments,
        totalTaxWithheld: cert.totalTaxWithheld,
        issuedAt: cert.issuedAt,
        downloadUrl: await getCertificateDownloadUrl(cert.pdfPath),
      }))
    );

    return res.status(200).json({
      success: true,
      message: 'Tax certificates retrieved successfully',
      data,
    });
  } catch (error) {
    console.error('Error fetching tax certificates:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch tax certificates'));
  }
};

/**
 * GET /api/workers/me/vat-summary
 * The worker's own generated VAT-collected summaries (per period) — for
 * their own 2550Q/2551Q filing. Informational only: this is never remitted
 * by the platform (see VatCollectionSummary's schema comment).
 */
export const getMyVatSummary = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const summaries = await prisma.vatCollectionSummary.findMany({
      where: { workerId: req.user.userId },
      orderBy: { periodStart: 'desc' },
    });

    return res.status(200).json({
      success: true,
      message: 'VAT summaries retrieved successfully',
      data: summaries.map((s) => ({
        id: s.id,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        totalVatCollected: s.totalVatCollected,
      })),
    });
  } catch (error) {
    console.error('Error fetching VAT summaries:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch VAT summaries'));
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

    // Included so mobile never hardcodes this admin-configurable cap
    // separately (see AppSettings.maxSlotsPerDay) — it's enforced for real in
    // updateAvailabilitySlots below regardless, this is just so the client
    // can match the server's actual limit instead of guessing at it.
    const { maxSlotsPerDay } = await getAppSettings();

    return res.status(200).json({
      success: true,
      message: 'Availability slots retrieved successfully',
      data: { slots, maxSlotsPerDay },
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
 * GET /api/workers/me/availability-template
 * A worker's recurring weekly pattern (see B8) — distinct from the concrete,
 * per-date WorkerAvailability rows above. Materialized forward into those
 * rows by materializeTemplateForWorker (called here on save, and again daily
 * by the sweep — see bookingWorker.materializeAvailabilityTemplates).
 */
export const getMyAvailabilityTemplate = async (req: AuthRequest, res: Response) => {
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

    const template = await prisma.workerAvailabilityTemplate.findMany({
      where: { workerProfileId: workerProfile.id },
      orderBy: [{ dayOfWeek: 'asc' }, { timeSlot: 'asc' }],
    });

    return res.status(200).json({
      success: true,
      message: 'Availability template retrieved successfully',
      data: { template: template.map((t) => ({ dayOfWeek: t.dayOfWeek, timeSlot: t.timeSlot })) },
    });
  } catch (error) {
    console.error('Error fetching availability template:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch availability template'));
  }
};

/**
 * PUT /api/workers/me/availability-template
 * Body: { days: [{ dayOfWeek, timeSlot }] } — dayOfWeek is 0=Sun..6=Sat.
 * Fully replaces the worker's template, then immediately materializes it
 * forward so the effect is visible right away rather than waiting for
 * tomorrow's sweep.
 */
export const updateMyAvailabilityTemplate = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { days } = req.body as { days: Array<{ dayOfWeek: number; timeSlot: TimeSlot }> };
    if (!Array.isArray(days)) {
      return res.status(400).json(errorResponse(400, 'days must be an array of { dayOfWeek, timeSlot }'));
    }
    for (const d of days) {
      if (
        typeof d.dayOfWeek !== 'number' ||
        d.dayOfWeek < 0 ||
        d.dayOfWeek > 6 ||
        !VALID_TIME_SLOTS.includes(d.timeSlot)
      ) {
        return res.status(400).json(errorResponse(400, 'Each day must have dayOfWeek 0-6 and a valid timeSlot'));
      }
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    await prisma.$transaction([
      prisma.workerAvailabilityTemplate.deleteMany({ where: { workerProfileId: workerProfile.id } }),
      prisma.workerAvailabilityTemplate.createMany({
        data: days.map((d) => ({ workerProfileId: workerProfile.id, dayOfWeek: d.dayOfWeek, timeSlot: d.timeSlot })),
      }),
    ]);

    await materializeTemplateForWorker(prisma, workerProfile.id);

    return res.status(200).json({
      success: true,
      message: 'Availability template updated successfully',
      data: { days },
    });
  } catch (error) {
    console.error('Error updating availability template:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update availability template'));
  }
};

/**
 * POST /api/workers/me/availability/unavailable-range
 * Body: { startDate, endDate } (YYYY-MM-DD, inclusive) — bulk "mark
 * unavailable" for a vacation/leave stretch (see B8), covering every
 * TimeSlot across the range in one call. All-or-nothing: if any date/slot in
 * range already has an active booking, nothing is changed and every
 * conflict is reported at once (409), mirroring updateAvailabilitySlots'
 * existing rule that a worker can't close a slot out from under a booking.
 */
export const bulkSetUnavailable = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { startDate, endDate } = req.body as { startDate: string; endDate: string };
    if (
      typeof startDate !== 'string' ||
      typeof endDate !== 'string' ||
      isNaN(new Date(startDate).getTime()) ||
      isNaN(new Date(endDate).getTime())
    ) {
      return res.status(400).json(errorResponse(400, 'startDate and endDate must be valid YYYY-MM-DD dates'));
    }
    const start = toDayStart(startDate);
    const end = toDayStart(endDate);
    if (start.getTime() > end.getTime()) {
      return res.status(400).json(errorResponse(400, 'startDate must not be after endDate'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const result = await setUnavailableRange(prisma, workerProfile.id, start, end, VALID_TIME_SLOTS);
    if (result.conflicts.length > 0) {
      return res.status(409).json({
        ...errorResponse(409, `${result.conflicts.length} slot(s) in this range have an active booking and can't be closed`),
        conflicts: result.conflicts,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Marked unavailable for the selected range',
      data: { blocked: result.blocked },
    });
  } catch (error) {
    console.error('Error setting unavailable range:', error);
    return res.status(500).json(errorResponse(500, 'Failed to mark this range unavailable'));
  }
};