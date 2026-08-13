import { Request, Response } from 'express';
import type { ConditionType, PaymentMethodType, RoomType, TimeSlot, UrgencyLevel } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import { formatDisplayId } from '@utils/formatters';
import { distanceKm, distanceMeters, isWithinRadiusMeters } from '@utils/geo';
import { findAutoMatchWorker } from '@services/matchingService';
import { validatePriceWithinPricingRule } from '@services/pricingRuleService';
import { authorizePaymentForBooking, captureAndReleasePayment, refundOrVoidPayment } from '@services/paymentLifecycleService';
import { toDayStart, findSlot, markSlotBooked, freeSlot } from '@services/workerAvailabilityService';
import { calculateWorkerPayout } from '@utils/pricing';
import { schedulePendingExpiry, cancelPendingExpiryJob } from '@queues/bookingQueue';
import { VALID_TRANSITIONS, isValidTransition } from '@services/bookingStateMachine';
import { getAppSettings } from '@services/appSettingsService';
import { computeWorkerTier, tierMultiplier } from '@utils/workerTier';
import { debitWalletTx, creditWalletTx, InsufficientBalanceError } from '@services/walletService';
import type { JwtPayload } from '@/types/index';

export { VALID_TRANSITIONS, isValidTransition };

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// Condition-based surcharge on the base price — HEAVY jobs take more effort;
// TIDY/NORMAL carry no adjustment.
const CONDITION_FEE_MULTIPLIER: Record<string, number> = { TIDY: 0, NORMAL: 0, HEAVY: 0.25 };
const URGENCY_FEE_MULTIPLIER: Record<string, number> = { STANDARD: 0, URGENT: 0.15, EMERGENCY: 0.3 };
// Distance-based surcharge beyond a free radius around the worker.
const FREE_DISTANCE_KM = 5;
const PER_KM_FEE = 10;
const DEFAULT_MATCH_RADIUS_KM = 30;

const round2 = (n: number): number => Math.round(n * 100) / 100;

async function resolveServiceTypeConfig(name: string) {
  return prisma.serviceType.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    include: { scopeFields: { include: { options: true } } },
  });
}

/**
 * POST /api/bookings
 * Create a new booking (client only).
 *
 * If workerId is omitted, runs the "surprise me" auto-match algorithm
 * (see matchingService.findAutoMatchWorker) to pick a worker instead of
 * requiring the client to choose one. Price is always computed server-side
 * (basePrice + condition surcharge + distance surcharge), logged via
 * PricingLog, and checked against any PricingRule for (city, serviceType).
 * A Payment row is created immediately in an authorized/held state (see
 * paymentLifecycleService.authorizePaymentForBooking) rather than after
 * completion, and a 1-hour expiry job is queued so an unanswered PENDING
 * booking auto-cancels (see queues/bookingQueue + workers/bookingWorker).
 */
export const createBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can create bookings'));
    }
    const clientId = req.user.userId;

    const {
      workerId: requestedWorkerId,
      serviceType,
      serviceTaskId,
      rooms,
      condition,
      description,
      address,
      city,
      lat,
      lng,
      date,
      timeSlot,
      urgencyLevel,
      addOns,
      packageIds,
      priorities,
      tip,
      notes,
      paymentMethodType,
      paymentAccountIdentifier,
      scopeAnswers,
      issuePhotoUrls,
    } = req.body as {
      workerId?: string;
      serviceType: string;
      serviceTaskId?: string;
      rooms?: RoomType[];
      condition?: ConditionType;
      description?: string;
      address: string;
      city?: string;
      lat: number;
      lng: number;
      date: string;
      timeSlot: TimeSlot;
      urgencyLevel?: UrgencyLevel;
      addOns?: Array<{ id?: string; name?: string; price: number }>;
      packageIds?: string[];
      priorities?: string[];
      tip?: number;
      notes?: string;
      paymentMethodType?: PaymentMethodType;
      paymentAccountIdentifier?: string;
      scopeAnswers?: Record<string, string | string[]>;
      issuePhotoUrls?: string[];
    };

    const VALID_URGENCY_LEVELS: UrgencyLevel[] = ['STANDARD', 'URGENT', 'EMERGENCY'];
    if (urgencyLevel !== undefined && !VALID_URGENCY_LEVELS.includes(urgencyLevel)) {
      return res.status(400).json(errorResponse(400, 'urgencyLevel must be one of STANDARD, URGENT, EMERGENCY'));
    }
    const effectiveUrgencyLevel: UrgencyLevel = urgencyLevel ?? 'STANDARD';

    const scheduledDate = toDayStart(date);
    const clientLocation = { lat, lng };
    const cityName = city ?? '';

    const serviceTask = serviceTaskId
      ? await prisma.serviceTask.findUnique({ where: { id: serviceTaskId }, include: { serviceType: true } })
      : null;

    if (serviceTaskId && !serviceTask) {
      return res.status(404).json(errorResponse(404, 'Service task not found'));
    }

    const resolvedServiceTypeName = serviceTask?.serviceType.name ?? serviceType;
    // Task-priced bookings aren't category-scoped — only fetch/enforce the
    // parent category's scope config (rooms vs custom fields, condition
    // on/off) when the client booked straight off a ServiceType.
    const serviceTypeConfig = serviceTask ? null : await resolveServiceTypeConfig(resolvedServiceTypeName);
    const basePrice = serviceTask?.basePrice ?? serviceTypeConfig?.basePrice ?? null;

    if (basePrice == null) {
      return res.status(404).json(errorResponse(404, 'Service type not found'));
    }

    if (serviceTypeConfig) {
      if (serviceTypeConfig.scopeType === 'ROOM_BASED') {
        if (!Array.isArray(rooms) || rooms.length === 0) {
          return res.status(400).json(errorResponse(400, 'At least one room is required for this service'));
        }
      } else if (serviceTypeConfig.scopeType === 'CUSTOM') {
        const answers: Record<string, string | string[]> =
          scopeAnswers && typeof scopeAnswers === 'object' && !Array.isArray(scopeAnswers)
            ? (scopeAnswers as Record<string, string | string[]>)
            : {};
        for (const field of serviceTypeConfig.scopeFields) {
          const answer = answers[field.label];
          const hasAnswer = Array.isArray(answer) ? answer.length > 0 : typeof answer === 'string' && answer.trim().length > 0;
          if (field.required && !hasAnswer) {
            return res.status(400).json(errorResponse(400, `"${field.label}" is required for this service`));
          }
          if (hasAnswer && (field.fieldType === 'SELECT' || field.fieldType === 'MULTI_SELECT')) {
            const validLabels = new Set(field.options.map((o) => o.label));
            const values = Array.isArray(answer) ? answer : [answer as string];
            if (!values.every((v) => validLabels.has(v))) {
              return res.status(400).json(errorResponse(400, `"${field.label}" has an invalid selection`));
            }
          }
        }
      }

      if (serviceTypeConfig.hasCondition && !condition) {
        return res.status(400).json(errorResponse(400, 'condition is required for this service'));
      }
    }

    // hasCondition=false means this category doesn't ask the question at
    // all — ignore whatever the client sent rather than erroring on it.
    const effectiveCondition = serviceTypeConfig && !serviceTypeConfig.hasCondition ? null : (condition ?? null);
    const effectiveScopeAnswers =
      scopeAnswers && typeof scopeAnswers === 'object' && !Array.isArray(scopeAnswers) ? scopeAnswers : undefined;
    const effectiveIssuePhotoUrls = Array.isArray(issuePhotoUrls)
      ? issuePhotoUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
      : [];

    const hasPets = Array.isArray(priorities) && priorities.some((p) => p.toLowerCase().includes('pet'));

    let resolvedWorkerId = requestedWorkerId ?? null;
    let isAutoMatched = false;
    let matchDistanceKm: number | null = null;

    if (!resolvedWorkerId) {
      const match = await findAutoMatchWorker({
        serviceType: resolvedServiceTypeName,
        serviceTaskId,
        date: scheduledDate,
        timeSlot,
        condition: effectiveCondition,
        rooms,
        hasPets,
        clientLocation,
        radiusKm: DEFAULT_MATCH_RADIUS_KM,
      });

      if (!match) {
        return res.status(404).json(errorResponse(404, 'No available worker found for this request'));
      }

      resolvedWorkerId = match.workerId;
      isAutoMatched = true;
      matchDistanceKm = match.distanceKm;
    }

    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: resolvedWorkerId } });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    if (workerProfile.kycStatus !== 'APPROVED') {
      return res.status(403).json(errorResponse(403, 'Worker is not verified yet'));
    }

    if (!workerProfile.isAvailable) {
      return res.status(409).json(errorResponse(409, 'Worker is not currently available'));
    }

    if (workerProfile.activeJobCount >= workerProfile.maxConcurrentJobs) {
      return res.status(409).json(errorResponse(409, 'Worker is at maximum capacity'));
    }

    const slot = await findSlot(prisma, workerProfile.id, scheduledDate, timeSlot);
    if (!slot || slot.isBlocked || slot.isBooked) {
      return res.status(409).json(errorResponse(409, 'Selected slot is no longer available'));
    }

    const workerDistanceKm =
      matchDistanceKm ??
      (workerProfile.currentLat != null && workerProfile.currentLng != null
        ? distanceKm(clientLocation, { lat: workerProfile.currentLat, lng: workerProfile.currentLng })
        : null);

    // Expertise tier — computed live from rating + completed-job count (see
    // utils/workerTier.ts), not stored, so it never drifts from those numbers.
    const appSettings = await getAppSettings();
    const workerCompletedJobs = await prisma.booking.count({
      where: { workerId: resolvedWorkerId, status: 'COMPLETED' },
    });
    const workerTier = computeWorkerTier(workerProfile.rating, workerCompletedJobs, appSettings);

    // Free job-preference toggles carry no price of their own — clamp
    // server-side so a tampered client can't slip a nonzero price through
    // this array (only resolvedPackages below, priced from the worker's own
    // WorkerPackage rows, are a trustworthy priced-add-on source).
    const preferenceAddOns = (Array.isArray(addOns) ? addOns : []).map((a) => ({
      name: a.name || a.id || 'Add-on',
      price: 0,
    }));

    let resolvedPackages: { name: string; price: number }[] = [];
    if (Array.isArray(packageIds) && packageIds.length > 0) {
      const found = await prisma.workerPackage.findMany({
        where: { id: { in: packageIds }, workerProfileId: workerProfile.id, isActive: true },
      });
      if (found.length !== packageIds.length) {
        return res.status(400).json(errorResponse(400, 'One or more selected packages are unavailable'));
      }
      resolvedPackages = found.map((p) => ({ name: p.name, price: p.price }));
    }

    const addOnsList = [...preferenceAddOns, ...resolvedPackages];
    const addOnsTotal = addOnsList.reduce((sum, a) => sum + (typeof a.price === 'number' ? a.price : 0), 0);
    const conditionFee = round2(basePrice * (CONDITION_FEE_MULTIPLIER[effectiveCondition ?? 'NORMAL'] ?? 0));
    const distanceFee = round2(workerDistanceKm != null ? Math.max(0, workerDistanceKm - FREE_DISTANCE_KM) * PER_KM_FEE : 0);
    const urgencyFee = round2(basePrice * (URGENCY_FEE_MULTIPLIER[effectiveUrgencyLevel] ?? 0));
    const tierFee = round2(basePrice * (tierMultiplier(workerTier, appSettings) - 1));
    const estimatedPrice = round2(basePrice + conditionFee + distanceFee + urgencyFee + tierFee);
    const finalEstimate = round2(estimatedPrice + addOnsTotal);

    const priceCheck = await validatePriceWithinPricingRule(cityName, resolvedServiceTypeName, finalEstimate);
    if (!priceCheck.ok) {
      return res.status(409).json(
        errorResponse(
          409,
          `Calculated price ₱${finalEstimate} is outside the allowed range (₱${priceCheck.bounds.minPrice}–₱${priceCheck.bounds.maxPrice}) for ${cityName || 'this city'}/${resolvedServiceTypeName}`
        )
      );
    }

    try {
      const { booking, payment } = await prisma.$transaction(async (tx) => {
        // Re-check KYC + capacity + slot inside the transaction to close the
        // race between the checks above and this insert (e.g. an admin
        // rejecting the worker in that window).
        const workerTx = await tx.workerProfile.findUnique({ where: { userId: resolvedWorkerId! } });
        if (!workerTx) throw new Error('WORKER_NOT_FOUND');
        if (workerTx.kycStatus !== 'APPROVED') throw new Error('WORKER_NOT_APPROVED');
        if (workerTx.activeJobCount >= workerTx.maxConcurrentJobs) throw new Error('AT_CAPACITY');

        const slotTx = await findSlot(tx, workerTx.id, scheduledDate, timeSlot);
        if (!slotTx || slotTx.isBlocked || slotTx.isBooked) throw new Error('SLOT_TAKEN');

        const created = await tx.booking.create({
          data: {
            clientId,
            workerId: resolvedWorkerId,
            serviceType: resolvedServiceTypeName,
            serviceTaskId: serviceTaskId ?? null,
            description: description ?? '',
            estimatedDurationHours: serviceTask?.durationHours ?? null,
            rooms: Array.isArray(rooms) ? rooms : [],
            condition: effectiveCondition,
            priorities: Array.isArray(priorities) ? priorities : [],
            addOnsSnapshot: addOnsList.length > 0 ? addOnsList : undefined,
            scopeAnswers: effectiveScopeAnswers,
            issuePhotoUrls: effectiveIssuePhotoUrls,
            scheduledDate,
            timeSlot,
            urgencyLevel: effectiveUrgencyLevel,
            isAutoMatched,
            declinedWorkerIds: [],
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            estimatedPrice,
            tip: typeof tip === 'number' ? tip : 0,
            notes: notes ?? null,
            paymentMethodType: paymentMethodType ?? null,
            paymentAccountIdentifier: paymentAccountIdentifier ?? null,
            location: address,
            city: cityName,
            clientLat: lat,
            clientLng: lng,
            workerLat: workerProfile.currentLat ?? null,
            workerLng: workerProfile.currentLng ?? null,
            distanceMeters: workerDistanceKm != null ? Math.round(workerDistanceKm * 1000) : null,
            status: 'PENDING',
          },
          include: {
            client: { select: { id: true, fullName: true, email: true } },
            worker: { select: { id: true, fullName: true, email: true } },
            serviceTask: true,
          },
        });

        if (addOnsList.length > 0) {
          await tx.bookingAddOn.createMany({
            data: addOnsList.map((a) => ({
              bookingId: created.id,
              name: a.name,
              price: typeof a.price === 'number' ? a.price : 0,
            })),
          });
        }

        await tx.pricingLog.create({
          data: {
            bookingId: created.id,
            basePrice,
            conditionFee,
            distanceFee,
            urgencyFee,
            tierFee,
            addOnsTotal,
            finalEstimate,
            breakdown: {
              basePrice,
              conditionFee,
              distanceFee,
              urgencyFee,
              tierFee,
              addOnsTotal,
              finalEstimate,
              condition: effectiveCondition,
              urgencyLevel: effectiveUrgencyLevel,
              workerTier,
              distanceKm: workerDistanceKm,
              isAutoMatched,
            },
          },
        });

        await markSlotBooked(tx, workerTx.id, scheduledDate, timeSlot);

        const createdPayment = await authorizePaymentForBooking(tx, created, addOnsTotal);

        return { booking: created, payment: createdPayment };
      });

      await schedulePendingExpiry(booking.id);

      await notifyUser({
        userId: booking.workerId as string,
        type: 'BOOKING_REQUEST',
        title: 'New Booking Request',
        message: `${booking.client.fullName} has requested your service`,
        relatedId: booking.id,
      });

      return res.status(201).json({
        success: true,
        message: 'Booking created successfully',
        data: {
          id: booking.id,
          clientName: booking.client.fullName,
          workerName: booking.worker?.fullName ?? null,
          isAutoMatched,
          status: booking.status,
          scheduledDate: booking.scheduledDate,
          timeSlot: booking.timeSlot,
          urgencyLevel: booking.urgencyLevel,
          workerTier,
          estimatedPrice: booking.estimatedPrice,
          estimatedDurationHours: booking.estimatedDurationHours,
          expiresAt: booking.expiresAt,
          pricing: { basePrice, conditionFee, distanceFee, urgencyFee, tierFee, addOnsTotal, finalEstimate },
          payment: { id: payment.id, status: payment.status, escrowStatus: payment.escrowStatus, clientSecret: payment.clientSecret },
        },
      });
    } catch (txErr: any) {
      if (txErr.message === 'SLOT_TAKEN') {
        return res.status(409).json(errorResponse(409, 'Slot no longer available'));
      }
      if (txErr.message === 'AT_CAPACITY') {
        return res.status(409).json(errorResponse(409, 'Worker is at maximum capacity'));
      }
      if (txErr.message === 'WORKER_NOT_FOUND') {
        return res.status(404).json(errorResponse(404, 'Worker not found'));
      }
      if (txErr.message === 'WORKER_NOT_APPROVED') {
        return res.status(403).json(errorResponse(403, 'Worker is not verified yet'));
      }
      if (txErr.code === 'P2002') {
        return res.status(409).json(errorResponse(409, 'Slot no longer available'));
      }
      throw txErr;
    }
  } catch (error) {
    console.error('Error creating booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to create booking'));
  }
};

/**
 * GET /api/bookings
 * List bookings (role-filtered: clients see their own, workers see assigned to them)
 */
export const listBookings = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { status, page = '1', limit = '10' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const skip = (pageNum - 1) * limitNum;

    const whereClause: any = {};

    if (req.user.role === 'CLIENT') {
      whereClause.clientId = req.user.userId;
    } else if (req.user.role === 'WORKER') {
      whereClause.workerId = req.user.userId;
    }

    if (status && typeof status === 'string') {
      whereClause.status = status;
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: whereClause,
        include: {
          client: { select: { id: true, fullName: true, avatar: true, phone: true } },
          worker: {
            select: {
              id: true,
              fullName: true,
              avatar: true,
              phone: true,
              workerProfile: { select: { kycStatus: true } },
            },
          },
          serviceTask: { select: { id: true, name: true, serviceType: { select: { name: true } } } },
          review: { select: { rating: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.booking.count({ where: whereClause }),
    ]);

    // workerPayoutEstimate below uses the live AppSettings rates (not the
    // COMMISSION_RATE/WITHHOLDING_TAX_RATE env-var defaults) so this estimate
    // doesn't silently drift once an admin changes the platform's commission
    // rate — the real payout is still only settled from the Payment row.
    const { commissionRate, withholdingTaxRate } = await getAppSettings();

    // Worker-facing list needs enough of the job scope to size up a request
    // (rooms, condition, distance, payout) without a second round-trip to
    // getBookingDetail per row.
    const formattedBookings = bookings.map((b: any) => ({
      id: b.id,
      clientName: b.client.fullName,
      clientId: b.client.id,
      clientPhone: b.client.phone,
      clientAvatar: b.client.avatar ?? null,
      workerName: b.worker?.fullName ?? null,
      workerId: b.worker?.id ?? null,
      workerPhone: b.worker?.phone ?? null,
      workerAvatar: b.worker?.avatar ?? null,
      workerVerified: b.worker?.workerProfile?.kycStatus === 'APPROVED',
      service: b.serviceTask?.name ?? b.serviceType,
      category: b.serviceTask?.serviceType?.name ?? b.serviceType,
      status: b.status,
      scheduledDate: b.scheduledDate,
      timeSlot: b.timeSlot,
      urgencyLevel: b.urgencyLevel,
      rooms: b.rooms,
      condition: b.condition,
      location: b.location,
      city: b.city,
      distanceMeters: b.distanceMeters,
      estimatedPrice: b.estimatedPrice,
      finalPrice: b.finalPrice,
      // Estimate only — the authoritative payout is on the Payment row,
      // settled at capture time (see paymentLifecycleService).
      workerPayoutEstimate: calculateWorkerPayout(b.finalPrice ?? b.estimatedPrice, b.tip ?? 0, commissionRate, withholdingTaxRate),
      rating: b.review?.rating ?? null,
    }));

    return res.status(200).json({
      success: true,
      message: 'Bookings retrieved successfully',
      data: {
        bookings: formattedBookings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Error listing bookings:', error);
    return res.status(500).json(errorResponse(500, 'Failed to list bookings'));
  }
};

/**
 * GET /api/bookings/:id
 * Get booking detail with ownership check
 */
export const getBookingDetail = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const id = req.params.id as string;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, fullName: true, email: true, phone: true, avatar: true } },
        worker: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatar: true,
            workerProfile: { select: { kycStatus: true } },
          },
        },
        serviceTask: { include: { serviceType: { select: { name: true } } } },
        payment: true,
        // Quote data lives inline on Booking (laborCost, materialsCost, etc.)
        addOns: true,  // schema relation is addOns (capital O)
        review: true,
        pricingLogs: { orderBy: { createdAt: 'asc' } },
        disputes: { orderBy: { createdAt: 'desc' } },
        arrivalVerification: true,
        cancellation: true,
      },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    // Check ownership (client, assigned worker, or any admin)
    const isOwner = booking.clientId === req.user.userId || booking.workerId === req.user.userId;
    if (!isOwner && req.user.role !== 'ADMIN') {
      return res.status(403).json(errorResponse(403, 'You do not have permission to view this booking'));
    }

    // addOns use `price` field (not `cost`) per schema
    const addonsCost = (booking.addOns || []).reduce((sum: number, addon: any) => sum + addon.price, 0);
    const hasQuote = booking.laborCost != null && booking.materialsCost != null;
    const finalPrice = hasQuote
      ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0) + addonsCost
      : booking.estimatedPrice + addonsCost;

    return res.status(200).json({
      success: true,
      message: 'Booking details retrieved successfully',
      data: {
        id: booking.id,
        client: booking.client,
        worker: booking.worker
          ? {
              id: booking.worker.id,
              fullName: booking.worker.fullName,
              email: booking.worker.email,
              phone: booking.worker.phone,
              avatar: booking.worker.avatar,
              verified: booking.worker.workerProfile?.kycStatus === 'APPROVED',
            }
          : null,
        service: booking.serviceTask?.name ?? booking.serviceType,
        category: booking.serviceTask?.serviceType?.name ?? booking.serviceType,
        status: booking.status,
        location: booking.location,
        city: booking.city,
        scheduledDate: booking.scheduledDate,
        scheduledTime: booking.scheduledTime,
        timeSlot: booking.timeSlot,
        urgencyLevel: booking.urgencyLevel,
        rooms: booking.rooms,
        condition: booking.condition,
        scopeAnswers: booking.scopeAnswers,
        priorities: booking.priorities,
        isAutoMatched: booking.isAutoMatched,
        estimatedPrice: booking.estimatedPrice,
        finalPrice,
        completionPhotoUrl: booking.completionPhotoUrl,
        estimatedDurationHours: booking.estimatedDurationHours,
        inspectionFeeCharged: booking.inspectionFeeCharged,
        inspectionFeeAmount: booking.inspectionFeeAmount,
        // Settled at booking time — used to auto-process payment after
        // completion is confirmed, without asking the client again.
        paymentMethodType: booking.paymentMethodType,
        paymentAccountIdentifier: booking.paymentAccountIdentifier,
        payment: booking.payment
          ? {
              id: booking.payment.id,
              methodType: booking.payment.methodType,
              accountIdentifier: booking.payment.accountIdentifier,
              status: booking.payment.status,
              escrowStatus: booking.payment.escrowStatus,
              totalAmount: booking.payment.totalAmount,
              authorizedAmount: booking.payment.authorizedAmount,
              authorizedAt: booking.payment.authorizedAt,
              capturedAmount: booking.payment.capturedAmount,
              capturedAt: booking.payment.capturedAt,
              releasedAt: booking.payment.releasedAt,
              subtotal: booking.payment.subtotal,
              tip: booking.payment.tip,
              commissionAmount: booking.payment.commissionAmount,
              withholdingTaxAmount: booking.payment.withholdingTaxAmount,
              workerPayout: booking.payment.workerPayout,
            }
          : null,
        quote: hasQuote
          ? {
              laborCost: booking.laborCost,
              materialsCost: booking.materialsCost,
              notes: booking.quoteNotes,
              status: booking.quoteStatus,
              quotedAt: booking.quotedAt,
            }
          : null,
        addOns: booking.addOns,
        review: booking.review,
        notes: booking.notes,
        // Chronological milestones for a status-progress UI.
        timeline: {
          createdAt: booking.createdAt,
          acceptedAt: ['ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED', 'DISPUTED', 'PENDING_COMPLETION', 'COMPLETED'].includes(booking.status) ? booking.updatedAt : null,
          workerArrivedAt: booking.workerArrivedAt,
          workerStartedAt: booking.workerStartedAt,
          quotedAt: booking.quotedAt,
          approvedAt: booking.approvedAt,
          completionDate: booking.completionDate,
        },
        pricingLogs: booking.pricingLogs,
        disputes: booking.disputes,
        arrivalVerification: booking.arrivalVerification,
        cancellation: booking.cancellation,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching booking detail:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch booking details'));
  }
};

/**
 * PATCH /api/bookings/:id/accept
 * Worker accepts booking (transaction-wrapped capacity check)
 */
export const acceptBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can accept bookings'));
    }

    const id = req.params.id as string;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }

    if (booking.status !== 'PENDING') {
      return res.status(409).json(errorResponse(409, `Cannot accept booking with status ${booking.status}`));
    }

    const currentUserId = req.user.userId;
    const { adminFeePerJob } = await getAppSettings();

    // Wrap in transaction to prevent double-counting
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Check current capacity
        const workerProfile = await tx.workerProfile.findUnique({
          where: { userId: currentUserId },
        });

        if (!workerProfile) {
          throw new Error('Worker profile not found');
        }

        if (workerProfile.activeJobCount >= workerProfile.maxConcurrentJobs) {
          throw new Error('Worker is at maximum capacity');
        }

        // Admin-fee gate — blocks acceptance if the worker's prepaid wallet
        // can't cover the flat per-job fee (see walletService.ts).
        if (adminFeePerJob > 0) {
          await debitWalletTx(tx, workerProfile.id, adminFeePerJob, 'ADMIN_FEE_DEDUCTION', { bookingId: id });
        }

        // Update booking status
        const updated = await tx.booking.update({
          where: { id },
          data: { status: 'ACCEPTED' },
        });

        // Increment activeJobCount
        await tx.workerProfile.update({
          where: { userId: currentUserId },
          data: { activeJobCount: { increment: 1 } },
        });

        if (booking.timeSlot) {
          await markSlotBooked(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot);
        }

        return updated;
      });

      // The booking is no longer PENDING, so the 1-hour auto-expiry no
      // longer applies.
      await cancelPendingExpiryJob(id);

      // Create notification for client
      await notifyUser({
        userId: result.clientId,
        type: 'BOOKING_ACCEPTED',
        title: 'Booking Accepted',
        message: 'Your booking has been accepted',
        relatedId: result.id,
      });

      return res.status(200).json({
        success: true,
        message: 'Booking accepted successfully',
        data: {
          id: result.id,
          status: result.status,
        },
      });
    } catch (txError: any) {
      if (txError.message === 'Worker is at maximum capacity') {
        return res.status(409).json(errorResponse(409, txError.message));
      }
      if (txError instanceof InsufficientBalanceError) {
        // 402 is a deliberately distinct status from the other errors here
        // (403/404/409) so the mobile app can point the worker at the
        // wallet top-up screen instead of showing a generic error toast.
        return res.status(402).json(
          errorResponse(
            402,
            `Insufficient wallet balance to accept this job. A ₱${adminFeePerJob} admin fee is required — please top up your wallet.`
          )
        );
      }
      throw txError;
    }
  } catch (error) {
    console.error('Error accepting booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to accept booking'));
  }
};

/**
 * PATCH /api/bookings/:id/decline
 * Worker declines a PENDING booking. Records the decline (DeclinedWorker +
 * Booking.declinedWorkerIds), moves the booking to the terminal REJECTED
 * status, voids the payment hold, and returns alternative worker candidates
 * (re-running auto-match excluding every worker who's declined so far) so
 * the client can pick another one without starting the booking from scratch.
 */
export const declineBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can decline bookings'));
    }

    const id = req.params.id as string;
    const { reason } = req.body;
    const workerId = req.user.userId;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.workerId !== workerId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }

    // Only PENDING bookings can be declined by a worker
    if (booking.status !== 'PENDING') {
      return res.status(409).json(errorResponse(409, `Cannot decline booking with status ${booking.status}`));
    }

    const updatedDeclinedWorkerIds = Array.from(new Set([...booking.declinedWorkerIds, workerId]));
    const { maxDeclinesBeforeCooldown, declineWindowHours, declineCooldownHours } = await getAppSettings();

    const updated = await prisma.$transaction(async (tx) => {
      await tx.declinedWorker.upsert({
        where: { bookingId_workerId: { bookingId: id, workerId } },
        create: { bookingId: id, workerId, reason: typeof reason === 'string' ? reason : null },
        update: { reason: typeof reason === 'string' ? reason : null },
      });

      const workerProfile = await tx.workerProfile.findUnique({ where: { userId: workerId }, select: { id: true } });
      if (workerProfile && booking.timeSlot) {
        await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot);
      }

      // Decline-limit cooldown — count this worker's declines in the rolling
      // window; once they hit the threshold, exclude them from auto-match
      // for a while (see matchingService.findAutoMatchWorker).
      const windowStart = new Date(Date.now() - declineWindowHours * 60 * 60 * 1000);
      const recentDeclineCount = await tx.declinedWorker.count({
        where: { workerId, declinedAt: { gte: windowStart } },
      });
      if (workerProfile && recentDeclineCount >= maxDeclinesBeforeCooldown) {
        await tx.workerProfile.update({
          where: { id: workerProfile.id },
          data: { declineCooldownUntil: new Date(Date.now() + declineCooldownHours * 60 * 60 * 1000) },
        });
      }

      return tx.booking.update({
        where: { id },
        data: {
          status: 'REJECTED',
          declinedWorkerIds: updatedDeclinedWorkerIds,
        },
      });
    });

    await cancelPendingExpiryJob(id);
    await refundOrVoidPayment(id, 'WORKER_DECLINED').catch((error) => {
      console.error(`Failed to void payment for declined booking ${id}:`, error);
    });

    await writeAuditLog({
      actorId: workerId,
      actorName: req.user.email,
      actorRole: req.user.role,
      action: 'BOOKING_DECLINED',
      category: 'STATUS_CHANGE',
      message: `Worker declined booking ${formatDisplayId(id)}`,
      metadata: { bookingId: id, workerId },
    });

    // Suggest alternatives — best-effort; a client-facing rebooking flow
    // still goes through POST /api/bookings with workerId omitted.
    const alternatives = updated.timeSlot
      ? await findAutoMatchWorker({
          serviceType: updated.serviceType,
          serviceTaskId: updated.serviceTaskId,
          date: updated.scheduledDate,
          timeSlot: updated.timeSlot,
          condition: updated.condition,
          rooms: updated.rooms,
          clientLocation: { lat: updated.clientLat ?? 0, lng: updated.clientLng ?? 0 },
          radiusKm: DEFAULT_MATCH_RADIUS_KM,
          excludeWorkerIds: updatedDeclinedWorkerIds,
        }).catch(() => null)
      : null;

    // Notify client
    await notifyUser({
      userId: updated.clientId,
      type: 'BOOKING_REJECTED',
      title: 'Booking Declined',
      message: 'The worker has declined your booking request',
      relatedId: id,
    });

    return res.status(200).json({
      success: true,
      message: 'Booking declined successfully',
      data: {
        id: updated.id,
        status: updated.status,
        alternativeWorkerId: alternatives?.workerId ?? null,
      },
    });
  } catch (error) {
    console.error('Error declining booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to decline booking'));
  }
};

/**
 * PATCH /api/bookings/:id/arrive
 * Worker checks in at the job site. Requires status ACCEPTED and the
 * worker's reported GPS to be within the admin-configured geofence radius
 * (AppSettings.geofenceRadiusMeters) of the client's booking address.
 * Records an ArrivalVerification audit row and stamps
 * Booking.workerArrivedAt — required before /start can fire.
 */
export const arriveBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can check in as arrived'));
    }

    const id = req.params.id as string;
    const { lat, lng } = req.body as { lat: number; lng: number };

    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }

    if (booking.status !== 'ACCEPTED') {
      return res.status(409).json(errorResponse(409, `Cannot check in for booking with status ${booking.status}`));
    }

    if (booking.clientLat == null || booking.clientLng == null) {
      return res.status(409).json(errorResponse(409, 'Booking has no client location on file to verify arrival against'));
    }

    const { geofenceRadiusMeters } = await getAppSettings();
    const clientLocation = { lat: booking.clientLat, lng: booking.clientLng };
    const workerLocation = { lat, lng };
    const distance = distanceMeters(clientLocation, workerLocation);
    const isVerified = isWithinRadiusMeters(clientLocation, workerLocation, geofenceRadiusMeters);

    if (!isVerified) {
      return res.status(409).json(
        errorResponse(409, `You are ${Math.round(distance)}m from the job site — must be within ${geofenceRadiusMeters}m to check in`)
      );
    }

    const [arrival, updated] = await prisma.$transaction([
      prisma.arrivalVerification.create({
        data: { bookingId: id, workerLat: lat, workerLng: lng, distanceMeters: distance, isVerified: true },
      }),
      prisma.booking.update({
        where: { id },
        data: { workerArrivedAt: new Date(), workerLat: lat, workerLng: lng },
      }),
    ]);

    await notifyUser({
      userId: updated.clientId,
      type: 'BOOKING_ACCEPTED',
      title: 'Worker Has Arrived',
      message: 'Your worker has checked in at the job site.',
      relatedId: id,
    });

    return res.status(200).json({
      success: true,
      message: 'Arrival verified successfully',
      data: {
        id: updated.id,
        workerArrivedAt: updated.workerArrivedAt,
        arrivalVerification: {
          id: arrival.id,
          distanceMeters: arrival.distanceMeters,
          isVerified: arrival.isVerified,
          createdAt: arrival.createdAt,
        },
      },
    });
  } catch (error) {
    console.error('Error verifying arrival:', error);
    return res.status(500).json(errorResponse(500, 'Failed to verify arrival'));
  }
};

/**
 * PATCH /api/bookings/:id/start
 * Worker marks booking as in progress — requires a prior verified arrival.
 */
export const startBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can start bookings'));
    }

    const id = req.params.id as string;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }

    if (!isValidTransition(booking.status, 'IN_PROGRESS')) {
      return res.status(409).json(errorResponse(409, `Cannot start booking with status ${booking.status}`));
    }

    if (!booking.workerArrivedAt) {
      return res.status(409).json(errorResponse(409, 'You must check in as arrived before starting this job'));
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { status: 'IN_PROGRESS', workerStartedAt: new Date() },
    });

    // Notify client
    await notifyUser({
      userId: updated.clientId,
      // No BOOKING_STARTED in schema; BOOKING_ACCEPTED is the closest available
      type: 'BOOKING_ACCEPTED',
      title: 'Service Started',
      message: 'The worker has started your service',
      relatedId: id,
    });

    return res.status(200).json({
      success: true,
      message: 'Booking started successfully',
      data: {
        id: updated.id,
        status: updated.status,
        workerStartedAt: updated.workerStartedAt,
      },
    });
  } catch (error) {
    console.error('Error starting booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to start booking'));
  }
};

/**
 * POST /api/bookings/:id/quote
 * Worker submits a quote for additional costs on top of the booking's
 * already-settled estimatedPrice (the labor cost, agreed at booking time).
 * laborCost is never taken from the request — it's always pinned to
 * booking.estimatedPrice so the client can't be charged more for labor than
 * what was agreed when they booked.
 * Quote data is stored inline on the Booking model (no separate Quote table in schema)
 */
export const submitQuote = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can submit quotes'));
    }

    const id = req.params.id as string;
    const { materialsCost, notes } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }

    if (!isValidTransition(booking.status, 'QUOTE_SUBMITTED')) {
      return res.status(409).json(errorResponse(409, `Cannot submit quote for booking with status ${booking.status}`));
    }

    // Quote fields live directly on Booking — no separate Quote model in schema.
    // laborCost is the booking's settled estimatedPrice, not worker input.
    const updated = await prisma.booking.update({
      where: { id },
      data: {
        laborCost: booking.estimatedPrice,
        materialsCost,
        quoteNotes: notes,
        quoteStatus: 'SUBMITTED',
        quotedAt: new Date(),
        status: 'QUOTE_SUBMITTED',
      },
    });

    // Log the revised total (labor + materials) so getBookingDetail's
    // pricingLogs shows the quote stage alongside the original estimate.
    await prisma.pricingLog.create({
      data: {
        bookingId: id,
        basePrice: updated.laborCost ?? booking.estimatedPrice,
        finalEstimate: (updated.laborCost ?? 0) + (updated.materialsCost ?? 0),
        breakdown: {
          stage: 'QUOTE_SUBMITTED',
          laborCost: updated.laborCost,
          materialsCost: updated.materialsCost,
          notes: updated.quoteNotes,
        },
      },
    });

    // Notify client
    await notifyUser({
      userId: booking.clientId,
      type: 'QUOTE_SUBMITTED',
      title: 'Quote Submitted',
      message: 'Worker has submitted a quote for your booking',
      relatedId: id,
    });

    return res.status(201).json({
      success: true,
      message: 'Quote submitted successfully',
      data: {
        id: updated.id,
        laborCost: updated.laborCost,
        materialsCost: updated.materialsCost,
        totalCost: (updated.laborCost ?? 0) + (updated.materialsCost ?? 0),
        notes: updated.quoteNotes,
      },
    });
  } catch (error) {
    console.error('Error submitting quote:', error);
    return res.status(500).json(errorResponse(500, 'Failed to submit quote'));
  }
};

/**
 * PATCH /api/bookings/:id/quote/approve
 * Client approves quote
 */
export const approveQuote = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can approve quotes'));
    }

    const id = req.params.id as string;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not yours'));
    }

    if (booking.laborCost == null || booking.materialsCost == null) {
      return res.status(400).json(errorResponse(400, 'No quote exists for this booking'));
    }

    if (!isValidTransition(booking.status, 'QUOTE_APPROVED')) {
      return res.status(409).json(errorResponse(409, `Cannot approve quote for booking with status ${booking.status}`));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status: 'QUOTE_APPROVED',
          quoteStatus: 'APPROVED',
          approvedAt: new Date(),
          finalPrice: booking.laborCost! + booking.materialsCost!,
        },
      });

      // Re-affirm the hold — a prior DISPUTED→QUOTE_APPROVED admin
      // resolution may have left this in a transient state.
      await tx.payment.updateMany({
        where: { bookingId: id, escrowStatus: { not: 'RELEASED' } },
        data: { escrowStatus: 'HELD' },
      });

      return b;
    });

    // Notify worker (workerId is nullable on Booking — skip if unassigned)
    if (booking.workerId) {
      await notifyUser({
        userId: booking.workerId,
        type: 'QUOTE_APPROVED',
        title: 'Quote Approved',
        message: 'Client has approved your quote',
        relatedId: id,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Quote approved successfully',
      data: {
        id: updated.id,
        status: updated.status,
        finalPrice: updated.finalPrice,
      },
    });
  } catch (error) {
    console.error('Error approving quote:', error);
    return res.status(500).json(errorResponse(500, 'Failed to approve quote'));
  }
};

/**
 * PATCH /api/bookings/:id/quote/dispute
 * Client disputes quote: creates a Dispute record (status OPEN, raised by
 * the client), moves the booking to DISPUTED, and notifies every admin so
 * one of them can resolve it via PATCH /api/admin/disputes/:id/resolve.
 * Schema uses DISPUTED (not QUOTE_DISPUTED) as the BookingStatus value.
 */
export const disputeQuote = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can dispute quotes'));
    }

    const id = req.params.id as string;
    const { reason } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not yours'));
    }

    if (booking.laborCost == null || booking.materialsCost == null) {
      return res.status(400).json(errorResponse(400, 'No quote exists for this booking'));
    }

    // Schema status is DISPUTED (not QUOTE_DISPUTED)
    if (!isValidTransition(booking.status, 'DISPUTED')) {
      return res.status(409).json(errorResponse(409, `Cannot dispute quote for booking with status ${booking.status}`));
    }

    const [updated, dispute] = await prisma.$transaction([
      prisma.booking.update({
        where: { id },
        data: {
          status: 'DISPUTED',
          quoteStatus: 'DISPUTED',
          disputeReason: reason,
        },
      }),
      prisma.dispute.create({
        data: {
          bookingId: id,
          raisedById: req.user.userId,
          reason: typeof reason === 'string' ? reason : 'Client disputed the submitted quote',
          status: 'OPEN',
        },
      }),
    ]);

    // Notify worker (workerId is nullable on Booking — skip if unassigned)
    if (booking.workerId) {
      await notifyUser({
        userId: booking.workerId,
        type: 'QUOTE_DISPUTED',
        title: 'Quote Disputed',
        message: `Client has disputed your quote: ${reason}`,
        relatedId: id,
      });
    }

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
    await Promise.all(
      admins.map((admin) =>
        notifyUser({
          userId: admin.id,
          type: 'QUOTE_DISPUTED',
          title: 'New Dispute Raised',
          message: `Booking ${formatDisplayId(id)} was disputed by the client: ${reason}`,
          relatedId: dispute.id,
        })
      )
    );

    return res.status(200).json({
      success: true,
      message: 'Quote disputed successfully',
      data: {
        id: updated.id,
        status: updated.status,
        disputeReason: updated.disputeReason,
        disputeId: dispute.id,
      },
    });
  } catch (error) {
    console.error('Error disputing quote:', error);
    return res.status(500).json(errorResponse(500, 'Failed to dispute quote'));
  }
};

/**
 * PATCH /api/bookings/:id/complete
 * Worker submits proof of completed work (a required photo). This does NOT
 * finalize the booking — it moves to PENDING_COMPLETION and waits for the
 * client to confirm via POST /api/bookings/:id/confirm-completion.
 */
export const completeBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can complete bookings'));
    }

    const id = req.params.id as string;
    const { completionPhotoUrl } = req.body as { completionPhotoUrl?: string };

    if (!completionPhotoUrl || typeof completionPhotoUrl !== 'string') {
      return res.status(400).json(errorResponse(400, 'A completion photo is required to complete this job'));
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }

    if (!isValidTransition(booking.status, 'PENDING_COMPLETION')) {
      return res.status(409).json(errorResponse(409, `Cannot complete booking with status ${booking.status}`));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status: 'PENDING_COMPLETION',
          completionPhotoUrl,
          workerCompletedAt: new Date(),
        },
      });

      // The worker's side of the job is done — free up their capacity and
      // calendar slot now rather than waiting on the client's confirmation,
      // which may be delayed or (via the 24h auto-settle job) skipped.
      if (booking.workerId) {
        const workerProfile = await tx.workerProfile.update({
          where: { userId: booking.workerId },
          data: { activeJobCount: { decrement: 1 } },
        });

        if (booking.timeSlot) {
          await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot);
        }
      }

      return b;
    });

    // Notify client to review the submitted photo and confirm
    await notifyUser({
      userId: booking.clientId,
      type: 'BOOKING_COMPLETED',
      title: 'Worker Submitted Completed Work',
      message: 'Please review the photo and confirm the job is done.',
      relatedId: id,
    });

    return res.status(200).json({
      success: true,
      message: 'Completion submitted — waiting for client confirmation',
      data: {
        id: updated.id,
        status: updated.status,
        completionPhotoUrl: updated.completionPhotoUrl,
      },
    });
  } catch (error) {
    console.error('Error completing booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to complete booking'));
  }
};

/**
 * PATCH /api/bookings/:id/confirm-completion
 * Client confirms the worker's submitted proof of work. Finalizes the
 * booking (COMPLETED, finalPrice), captures the held payment authorization
 * for the final amount, releases escrow to the worker, and notifies them
 * that payout has been triggered. activeJobCount/slot were already freed in
 * completeBooking (the worker's side of the job finishing), not here.
 */
export const confirmCompletion = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can confirm job completion'));
    }

    const id = req.params.id as string;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { addOns: true },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking does not belong to you'));
    }

    if (!isValidTransition(booking.status, 'COMPLETED')) {
      return res.status(409).json(errorResponse(409, `Cannot confirm completion for booking with status ${booking.status}`));
    }

    // addOns use `price` field per schema
    const addonsCost = (booking.addOns || []).reduce((sum: number, addon: any) => sum + addon.price, 0);
    const hasQuote = booking.laborCost != null && booking.materialsCost != null;
    const finalPrice = round2(
      hasQuote ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0) + addonsCost : booking.estimatedPrice + addonsCost
    );

    // Update booking — schema has completionDate (not completedAt)
    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        finalPrice,
        completionDate: new Date(),
      },
    });

    const payment = await captureAndReleasePayment(id, finalPrice, booking.workerId);

    // captureAndReleasePayment already sends a "payment released" notification —
    // this one separately confirms the job itself was accepted as done.
    if (booking.workerId) {
      await notifyUser({
        userId: booking.workerId,
        type: 'BOOKING_COMPLETED',
        title: 'Client Confirmed Completion',
        message: 'The client confirmed your work is done.',
        relatedId: id,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Completion confirmed successfully',
      data: {
        id: updated.id,
        status: updated.status,
        finalPrice: updated.finalPrice,
        completedAt: updated.completionDate,
        payment: {
          status: payment.status,
          escrowStatus: payment.escrowStatus,
          capturedAmount: payment.capturedAmount,
          workerPayout: payment.workerPayout,
        },
      },
    });
  } catch (error) {
    console.error('Error confirming booking completion:', error);
    return res.status(500).json(errorResponse(500, 'Failed to confirm completion'));
  }
};

/**
 * PATCH /api/bookings/:id/cancel
 * Cancel booking (status-gated)
 */
export const cancelBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const id = req.params.id as string;
    const { reason } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    // Check ownership
    if (booking.clientId !== req.user.userId && booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to cancel this booking'));
    }

    if (!isValidTransition(booking.status, 'CANCELLED')) {
      return res.status(409).json(errorResponse(409, `Cannot cancel booking with status ${booking.status}`));
    }

    const cancelledByRole = req.user.role === 'WORKER' ? 'WORKER' : 'CLIENT';

    const updated = await prisma.$transaction(async (tx) => {
      // If worker is cancelling after accepting (job was occupying capacity
      // and a calendar slot), free both up.
      if (booking.status === 'ACCEPTED' && booking.workerId) {
        const workerProfile = await tx.workerProfile.update({
          where: { userId: booking.workerId },
          data: { activeJobCount: { decrement: 1 } },
        });
        if (booking.timeSlot) {
          await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot);
        }

        // Refund the admin fee deducted at acceptance — but only when the
        // cancellation isn't the worker's own choice; a worker who backs out
        // of a job they already accepted forfeits the fee.
        if (cancelledByRole !== 'WORKER') {
          const { adminFeePerJob } = await getAppSettings();
          if (adminFeePerJob > 0) {
            await creditWalletTx(tx, workerProfile.id, adminFeePerJob, 'REFUND', { bookingId: id });
          }
        }
      }

      await tx.cancellation.create({
        data: {
          bookingId: id,
          cancelledBy: cancelledByRole,
          cancelledById: req.user!.userId,
          reason: typeof reason === 'string' ? reason : null,
        },
      });

      return tx.booking.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          notes: reason, // schema has no cancelReason; storing in notes
        },
      });
    });

    await cancelPendingExpiryJob(id);
    await refundOrVoidPayment(id, reason || 'Booking cancelled').catch((error) => {
      console.error(`Failed to void payment for cancelled booking ${id}:`, error);
    });

    // Notify the other party (workerId may be null if booking is unassigned)
    const notificationUserId =
      booking.clientId === req.user.userId ? booking.workerId : booking.clientId;

    if (notificationUserId) {
      await notifyUser({
        userId: notificationUserId,
        // No BOOKING_CANCELLED in schema; BOOKING_REJECTED is the closest
        type: 'BOOKING_CANCELLED',
        title: 'Booking Cancelled',
        message: `Booking has been cancelled: ${reason}`,
        relatedId: id,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        id: updated.id,
        status: updated.status,
      },
    });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to cancel booking'));
  }
};

/**
 * PATCH /api/bookings/:id/reschedule
 * Reschedule booking to new date/time
 * NOTE: schema only has scheduledDate (no scheduledTime field)
 */
export const rescheduleBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const id = req.params.id as string;
    const { newDate } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    // Check ownership
    if (booking.clientId !== req.user.userId && booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'You do not have permission to reschedule this booking'));
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        scheduledDate: new Date(newDate),
      },
    });

    // Notify the other party (workerId may be null if booking is unassigned)
    const notificationUserId =
      booking.clientId === req.user.userId ? booking.workerId : booking.clientId;

    if (notificationUserId) {
      await notifyUser({
        userId: notificationUserId,
        // No BOOKING_RESCHEDULED in schema; BOOKING_ACCEPTED is closest
        type: 'BOOKING_RESCHEDULED',
        title: 'Booking Rescheduled',
        message: `Booking has been rescheduled to ${newDate}`,
        relatedId: id,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Booking rescheduled successfully',
      data: {
        id: updated.id,
        scheduledDate: updated.scheduledDate,
      },
    });
  } catch (error) {
    console.error('Error rescheduling booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to reschedule booking'));
  }
};

/**
 * POST /api/bookings/:id/addons
 * Add scope-creep addon items mid-job
 * Schema model: BookingAddOn with fields: name, price (not title/description/cost)
 */
export const addAddon = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const id = req.params.id as string;
    const { name, price } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    // Only worker can add addons
    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'Only assigned worker can add addons'));
    }

    // prisma client accessor is bookingAddOn (capital O)
    const addon = await prisma.bookingAddOn.create({
      data: {
        bookingId: id,
        name,
        price,
      },
    });

    // Notify client — no ADDON_ADDED type; use MESSAGE_RECEIVED as proxy
    await notifyUser({
      userId: booking.clientId,
      type: 'ADDON_ADDED',
      title: 'Additional Service Added',
      message: `${name} has been added (₱${price})`,
      relatedId: id,
    });

    return res.status(201).json({
      success: true,
      message: 'Addon added successfully',
      data: addon,
    });
  } catch (error) {
    console.error('Error adding addon:', error);
    return res.status(500).json(errorResponse(500, 'Failed to add addon'));
  }
};

/**
 * POST /api/bookings/:id/review
 * Submit rating and review after completion
 */
export const submitReview = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can submit reviews'));
    }

    const id = req.params.id as string;
    const { rating, comment, photoUrls } = req.body;

    // `worker` on Booking is a User relation — include it directly (no nested `.user`)
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        worker: {
          select: { id: true, fullName: true },
        },
      },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not yours'));
    }

    if (booking.status !== 'COMPLETED') {
      return res.status(409).json(errorResponse(409, 'Can only review completed bookings'));
    }

    // A completed booking must have an assigned worker, but workerId is
    // nullable on Booking — narrow it before using it as a lookup key.
    if (!booking.workerId) {
      return res.status(409).json(errorResponse(409, 'Booking has no assigned worker'));
    }

    // Review model uses clientId (not reviewerId), and workerId references WorkerProfile.id
    // First resolve the WorkerProfile id from the worker's userId
    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: booking.workerId },
      select: { id: true },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const review = await prisma.review.create({
      data: {
        bookingId: id,
        workerId: workerProfile.id,   // WorkerProfile.id, not User.id
        clientId: req.user.userId,
        rating,
        comment,
        photoUrls: Array.isArray(photoUrls) ? photoUrls : [],
      },
    });

    // Update worker's average rating
    const allReviews = await prisma.review.findMany({
      where: { workerId: workerProfile.id },
    });

    const avgRating =
      allReviews.reduce((sum: number, r: any) => sum + r.rating, 0) / allReviews.length;

    await prisma.workerProfile.update({
      where: { id: workerProfile.id },
      data: {
        rating: Math.round(avgRating * 10) / 10,
        totalReviews: allReviews.length,
      },
    });

    // Notify worker — use REVIEW_RECEIVED (not NEW_REVIEW)
    await notifyUser({
      userId: booking.workerId,
      type: 'REVIEW_RECEIVED',
      title: 'New Review',
      message: `You received a ${rating}-star review`, // booking.client not included — avoid referencing it here
      relatedId: id,
    });

    return res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: {
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        photoUrls: review.photoUrls,
        workerNewRating: avgRating,
      },
    });
  } catch (error) {
    console.error('Error submitting review:', error);
    return res.status(500).json(errorResponse(500, 'Failed to submit review'));
  }
};