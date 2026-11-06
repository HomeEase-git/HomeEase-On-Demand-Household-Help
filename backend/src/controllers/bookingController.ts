import { Request, Response } from 'express';
import type { Booking, BookingStatus, ConditionType, PaymentMethodType, RoomType, WorkerCancellationReason } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { maskProfanity } from '@utils/profanityFilter';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { writeAuditLog } from '@utils/auditLog';
import { requestRefund } from '@services/refundRequestService';
import { formatDisplayId } from '@utils/formatters';
import { distanceMeters, isWithinRadiusMeters } from '@utils/geo';
import { resolveDrivingDistanceKm } from '@services/googleDistanceService';
import { taskBasePrice } from '@services/taskPriceService';
import { blockedUserIds } from '@services/blockService';
import { getWorkerSetupStatus, WORKER_SETUP_INCOMPLETE_MESSAGE } from '@services/workerSetupService';
import { findAutoMatchWorker, LATE_CANCEL_THRESHOLD_HOURS } from '@services/matchingService';
import {
  settleCashBooking,
  createCompletionInvoice,
  voidUnpaidPayment,
} from '@services/paymentLifecycleService';
import {
  toDayStart,
  isoDay,
  checkBookingStart,
  bookingStartTime,
  bookingStartInstant,
  clientNoShowDeadline,
  isOutsideBookedWindow,
  isWorkerAvailableOn,
  findNearbyJobs,
  formatTime12h,
} from '@services/workerAvailabilityService';
import { chargePenaltyTx } from '@services/debtLedgerService';
import { toOwnedBookingPhotoUrls } from '@utils/storageUrls';
import { validateInvoiceItems, invoiceLines, invoiceStatus, type InvoiceItemInput } from '@utils/invoiceItems';
import {
  updateBookingIfStatus,
  isBookingStatusConflict,
  lockBooking,
  BookingStatusConflictError,
} from '@services/bookingStatusWrite';
import { openBookingDispute, openOrJoinDisputeTx, escalateCancelRequest } from '@services/bookingProblemService';
import { cancelAsWorkerNoShow } from '@workers/bookingWorker';

const bookingConflict = (res: Response) =>
  res.status(409).json(errorResponse(409, 'This booking was just updated. Refresh and try again.'));
import {
  calculateWorkerPayout,
  computeBookingFinalTotal,
  computeJobPricing,
  computeWorkerEarnings,
  calculateCommission,
  calculateWithholdingTax,
  describeDistanceFee,
  itemizeBookingPrice,
  VAT_RATE,
} from '@utils/pricing';
import { roundToCentavo } from '@utils/money';
import { schedulePendingExpiry, cancelPendingExpiryJob } from '@queues/bookingQueue';
import { finalizeCancellationTx, afterCancellation } from '@services/bookingCancellationService';
import { applyClientFaultCompensationTx } from '@services/cancellationCompensationService';
import { VALID_TRANSITIONS, isValidTransition } from '@services/bookingStateMachine';
import { getAppSettings } from '@services/appSettingsService';
import { computeWorkerTier, tierMultiplier } from '@utils/workerTier';
import { getIO } from '../socket';
import type { JwtPayload } from '@/types/index';

export { VALID_TRANSITIONS, isValidTransition };

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const round2 = roundToCentavo;

async function resolveServiceTypeConfig(name: string) {
  return prisma.serviceType.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
}

const FOLLOW_UP_PARENT_STATUSES: BookingStatus[] = ['PENDING_COMPLETION', 'AWAITING_PAYMENT', 'COMPLETED'];

export const createBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can create bookings'));
    }
    const clientId = req.user.userId;

    const holdingClientProfile = await prisma.clientProfile.findUnique({
      where: { userId: clientId },
      select: { paymentHoldAt: true, paymentHoldNote: true },
    });
    if (holdingClientProfile?.paymentHoldAt) {
      return res.status(402).json(
        errorResponse(
          402,
          `Your account is on hold${holdingClientProfile.paymentHoldNote ? ` (${holdingClientProfile.paymentHoldNote})` : ''}. Please settle it before booking again.`
        )
      );
    }

    const {
      workerId: requestedWorkerId,
      serviceType,
      serviceTaskId,
      rooms,
      description,
      address,
      city,
      lat,
      lng,
      date,
      time,
      parentBookingId,
      addOns,
      packageIds,
      priorities,
      tip,
      notes,
      paymentMethodType,
      paymentAccountIdentifier,
      quantity,
      issuePhotoUrls,
      idempotencyKey,
    } = req.body as {
      workerId?: string;
      serviceType: string;
      serviceTaskId?: string;
      rooms?: RoomType[];
      description?: string;
      address: string;
      city?: string;
      lat: number;
      lng: number;
      date: string;
      time: string;
      parentBookingId?: string | null;
      addOns?: Array<{ id?: string; name?: string; price: number }>;
      packageIds?: string[];
      priorities?: string[];
      tip?: number;
      notes?: string;
      paymentMethodType?: PaymentMethodType;
      paymentAccountIdentifier?: string;
      quantity?: number;
      issuePhotoUrls?: string[];
      idempotencyKey?: string;
    };

    const blockedIds = await blockedUserIds(clientId);
    if (requestedWorkerId && blockedIds.includes(requestedWorkerId)) {
      return res.status(403).json(errorResponse(403, "You can't book this worker."));
    }

    const hasIdempotencyKey = typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0;
    if (hasIdempotencyKey) {
      const existing = await prisma.booking.findUnique({
        where: { client_idempotency_key_unique: { clientId, idempotencyKey: idempotencyKey! } },
        include: {
          client: { select: { fullName: true } },
          worker: { select: { fullName: true } },
          pricingLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      if (existing) {
        const log = existing.pricingLogs[0];
        return res.status(200).json({
          success: true,
          message: 'Booking already created for this request',
          data: {
            id: existing.id,
            clientName: existing.client.fullName,
            workerName: existing.worker?.fullName ?? null,
            isAutoMatched: existing.isAutoMatched,
            status: existing.status,
            scheduledDate: existing.scheduledDate,
            scheduledTime: bookingStartTime(existing),
            isRush: existing.isRush,
            workerTier: (log?.breakdown as { workerTier?: string } | null)?.workerTier ?? null,
            estimatedPrice: existing.estimatedPrice,
            estimatedDurationHours: existing.estimatedDurationHours,
            expiresAt: existing.expiresAt,
            pricing: log
              ? {
                  basePrice: log.basePrice,
                  conditionFee: log.conditionFee,
                  distanceFee: log.distanceFee,
                  urgencyFee: log.urgencyFee,
                  rushFee: log.rushFee ?? 0,
                  tierFee: log.tierFee,
                  addOnsTotal: log.addOnsTotal,
                  finalEstimate: log.finalEstimate,
                }
              : null,
            payment: null,
          },
        });
      }
    }

    const appSettings = await getAppSettings();

    const startCheck = checkBookingStart(date, time, appSettings.rushMinLeadHours);
    if (!startCheck.ok) {
      return res.status(400).json(errorResponse(400, startCheck.message));
    }
    const isRush = startCheck.isRush;

    const effectiveUrgencyLevel = 'STANDARD' as const;

    const scheduledDate = toDayStart(date);
    const clientLocation = { lat, lng };
    const cityName = city ?? '';

    const serviceTask = serviceTaskId
      ? await prisma.serviceTask.findUnique({
          where: { id: serviceTaskId },
          include: { serviceType: true },
        })
      : null;

    if (serviceTaskId && !serviceTask) {
      return res.status(404).json(errorResponse(404, 'Service task not found'));
    }
    if (serviceTask && (!serviceTask.isActive || !(serviceTask.basePrice > 0))) {
      return res.status(409).json(errorResponse(409, "This job isn't available right now. Please pick another one."));
    }

    let followUpWorkerId: string | null = null;
    if (parentBookingId) {
      const parent = await prisma.booking.findUnique({
        where: { id: parentBookingId },
        select: {
          clientId: true,
          workerId: true,
          status: true,
          serviceTask: { select: { allowsFollowUp: true } },
        },
      });
      if (!parent || parent.clientId !== clientId) {
        return res.status(404).json(errorResponse(404, 'The original booking was not found'));
      }
      if (!parent.serviceTask?.allowsFollowUp) {
        return res.status(409).json(errorResponse(409, 'Follow-up jobs can only be requested after an inspection or diagnosis job'));
      }
      if (!FOLLOW_UP_PARENT_STATUSES.includes(parent.status)) {
        return res.status(409).json(errorResponse(409, 'You can request a follow-up job once the inspection is finished'));
      }
      if (!parent.workerId || (requestedWorkerId && requestedWorkerId !== parent.workerId)) {
        return res.status(409).json(errorResponse(409, 'A follow-up job goes to the same worker who did the inspection'));
      }
      followUpWorkerId = parent.workerId;
    }

    const resolvedServiceTypeName = serviceTask?.serviceType.name ?? serviceType;
    const serviceTypeConfig = serviceTask ? null : await resolveServiceTypeConfig(resolvedServiceTypeName);

    if (!serviceTask && !serviceTypeConfig) {
      return res.status(404).json(errorResponse(404, 'Service type not found'));
    }

    const taskPrice = serviceTask ? taskBasePrice(serviceTask, quantity) : null;
    if (taskPrice && !taskPrice.ok) {
      return res.status(400).json(errorResponse(400, taskPrice.message));
    }
    const bookedQuantity = taskPrice?.ok ? (taskPrice.quantity ?? null) : null;

    const effectiveCondition: ConditionType | null = null;
    const effectiveIssuePhotoUrls = Array.isArray(issuePhotoUrls)
      ? issuePhotoUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
      : [];

    const hasPets = Array.isArray(priorities) && priorities.some((p) => p.toLowerCase().includes('pet'));

    let resolvedWorkerId = followUpWorkerId ?? requestedWorkerId ?? null;
    let isAutoMatched = false;

    const RECENT_DECLINE_COOLDOWN_HOURS = 48;
    const recentDeclineCutoff = new Date(Date.now() - RECENT_DECLINE_COOLDOWN_HOURS * 60 * 60 * 1000);
    const recentDeclines = await prisma.declinedWorker.findMany({
      where: { declinedAt: { gte: recentDeclineCutoff }, booking: { clientId } },
      select: { workerId: true },
      distinct: ['workerId'],
    });
    if (resolvedWorkerId && blockedIds.includes(resolvedWorkerId)) {
      return res.status(403).json(errorResponse(403, "You can't book this worker."));
    }
    const recentlyDeclinedWorkerIds = [...recentDeclines.map((d) => d.workerId), ...blockedIds];

    const autoMatchParams = {
      serviceType: resolvedServiceTypeName,
      serviceTaskId,
      date: scheduledDate,
      hasPets,
      clientLat: lat,
      clientLng: lng,
    };

    if (!resolvedWorkerId) {
      const match = await findAutoMatchWorker({ ...autoMatchParams, excludeWorkerIds: recentlyDeclinedWorkerIds });

      if (!match) {
        return res.status(404).json(errorResponse(404, 'No available worker found for this request'));
      }

      resolvedWorkerId = match.workerId;
      isAutoMatched = true;
    }

    const MAX_AUTO_MATCH_RETRIES = 2;
    const triedWorkerIds: string[] = [
      ...recentlyDeclinedWorkerIds,
      ...(isAutoMatched && resolvedWorkerId ? [resolvedWorkerId] : []),
    ];

    const requestingClient = await prisma.user.findUnique({ where: { id: clientId }, select: { phone: true } });

    for (let attempt = 0; ; attempt++) {
      const workerProfile = await prisma.workerProfile.findUnique({
        where: { userId: resolvedWorkerId },
        include: {
          user: { select: { phone: true, status: true } },
          serviceCategories: { include: { serviceType: { select: { name: true } } } },
        },
      });

      if (!workerProfile) {
        return res.status(404).json(errorResponse(404, 'Worker not found'));
      }

      const selfDealingFlag = Boolean(
        requestingClient?.phone && workerProfile.user.phone && requestingClient.phone === workerProfile.user.phone
      );

      const tryNextAutoMatchCandidate = async (): Promise<boolean> => {
        if (!isAutoMatched || attempt >= MAX_AUTO_MATCH_RETRIES) return false;
        const nextMatch = await findAutoMatchWorker({ ...autoMatchParams, excludeWorkerIds: triedWorkerIds });
        if (!nextMatch) return false;
        resolvedWorkerId = nextMatch.workerId;
        triedWorkerIds.push(resolvedWorkerId);
        return true;
      };

      if (!isAutoMatched) {
        const bookedCategory = workerProfile.serviceCategories.find(
          (c) => c.serviceType.name.toLowerCase() === resolvedServiceTypeName.toLowerCase()
        );
        if (!bookedCategory || bookedCategory.status !== 'VERIFIED') {
          return res.status(409).json(errorResponse(409, 'This worker does not offer this service'));
        }
      }

      if (workerProfile.kycStatus !== 'APPROVED') {
        return res.status(403).json(errorResponse(403, 'Worker is not verified yet'));
      }

      if (workerProfile.user.status !== 'ACTIVE' || !workerProfile.isAvailable || workerProfile.debtHoldAt) {
        if (await tryNextAutoMatchCandidate()) continue;
        return res.status(409).json(errorResponse(409, 'Worker is not currently available'));
      }

      if (!(await getWorkerSetupStatus(workerProfile.userId))?.complete) {
        if (await tryNextAutoMatchCandidate()) continue;
        return res.status(409).json(errorResponse(409, "This worker isn't taking bookings yet"));
      }

      if (!followUpWorkerId && !(await isWorkerAvailableOn(prisma, workerProfile, scheduledDate))) {
        if (await tryNextAutoMatchCandidate()) continue;
        return res.status(409).json(errorResponse(409, "This worker isn't working on that date"));
      }

      let basePrice: number;
      if (serviceTask) {
        const selection = await prisma.workerTaskSelection.findUnique({
          where: {
            workerProfileId_serviceTaskId: { workerProfileId: workerProfile.id, serviceTaskId: serviceTask.id },
          },
        });
        if (!selection?.isActive) {
          if (await tryNextAutoMatchCandidate()) continue;
          return res.status(409).json(errorResponse(409, 'This worker does not offer this specific service'));
        }
        basePrice = taskPrice!.ok ? taskPrice!.basePrice : 0;
      } else {
        basePrice = serviceTypeConfig!.basePrice;
      }

      const vatApplicable = false;
      const vatRate = null;

      const workerDistanceKm =
        workerProfile.addressLat != null && workerProfile.addressLng != null
          ? await resolveDrivingDistanceKm(clientLocation, { lat: workerProfile.addressLat, lng: workerProfile.addressLng })
          : null;

      const workerCompletedJobs = await prisma.booking.count({
        where: { workerId: resolvedWorkerId, status: 'COMPLETED' },
      });
      const workerTier = computeWorkerTier(
        { rating: workerProfile.rating, completedJobs: workerCompletedJobs, yearsExperience: workerProfile.yearsExperience },
        appSettings
      );

      const preferenceAddOns = (Array.isArray(addOns) ? addOns : []).map((a) => ({
        kind: 'PREFERENCE' as const,
        name: a.name || a.id || 'Add-on',
        price: 0,
      }));

      let resolvedPackages: { kind: 'PACKAGE'; name: string; price: number }[] = [];
      if (Array.isArray(packageIds) && packageIds.length > 0) {
        const found = await prisma.workerPackage.findMany({
          where: { id: { in: packageIds }, workerProfileId: workerProfile.id, isActive: true, status: 'APPROVED' },
        });
        if (found.length !== packageIds.length) {
          return res.status(400).json(errorResponse(400, 'One or more selected packages are unavailable'));
        }
        resolvedPackages = found.map((p) => ({ kind: 'PACKAGE' as const, name: p.name, price: p.price }));
      }

      const addOnsList = [...preferenceAddOns, ...resolvedPackages];
      const addOnsTotal = addOnsList.reduce((sum, a) => sum + (typeof a.price === 'number' ? a.price : 0), 0);
      const { distanceFee, urgencyFee, rushFee, tierFee, estimatedPrice } = computeJobPricing({
        basePrice,
        tierMultiplier: tierMultiplier(workerTier, appSettings),
        rushFeeRate: isRush ? appSettings.rushFeeRate : 0,
        distanceKm: workerDistanceKm,
        freeDistanceKm: appSettings.freeDistanceKm,
        perKmFee: appSettings.perKmFee,
      });
      const conditionFee = 0;
      const finalEstimate = round2(estimatedPrice + addOnsTotal);

      try {
        const booking = await prisma.$transaction(async (tx) => {
          const workerTx = await tx.workerProfile.findUnique({ where: { userId: resolvedWorkerId! } });
          if (!workerTx) throw new Error('WORKER_NOT_FOUND');
          if (workerTx.kycStatus !== 'APPROVED') throw new Error('WORKER_NOT_APPROVED');

          const created = await tx.booking.create({
            data: {
              clientId,
              workerId: resolvedWorkerId,
              parentBookingId: parentBookingId ?? null,
              serviceType: resolvedServiceTypeName,
              serviceTaskId: serviceTaskId ?? null,
              description: description ?? '',
              estimatedDurationHours: serviceTask?.durationHours ?? null,
              rooms: Array.isArray(rooms) ? rooms : [],
              condition: effectiveCondition,
              priorities: Array.isArray(priorities) ? priorities : [],
              addOnsSnapshot: addOnsList.length > 0 ? addOnsList : undefined,
              quantity: bookedQuantity,
              issuePhotoUrls: effectiveIssuePhotoUrls,
              scheduledDate,
              scheduledTime: time,
              isRush,
              isAutoMatched,
              selfDealingFlag,
              declinedWorkerIds: [],
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
              idempotencyKey: hasIdempotencyKey ? (idempotencyKey as string) : null,
              estimatedPrice,
              vatApplicable,
              vatRate,
              tip: typeof tip === 'number' ? tip : 0,
              notes: notes ?? null,
              paymentMethodType: paymentMethodType ?? null,
              paymentAccountIdentifier: paymentAccountIdentifier ?? null,
              location: address,
              city: cityName,
              clientLat: lat,
              clientLng: lng,
              workerLat: workerProfile.addressLat ?? null,
              workerLng: workerProfile.addressLng ?? null,
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
            const chosenAt = new Date();
            await tx.bookingAddOn.createMany({
              data: addOnsList.map((a) => ({
                bookingId: created.id,
                kind: a.kind,
                name: a.name,
                price: typeof a.price === 'number' ? a.price : 0,
                clientApprovedAt: chosenAt,
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
              rushFee,
              tierFee,
              addOnsTotal,
              finalEstimate,
              breakdown: {
                basePrice,
                conditionFee,
                distanceFee,
                urgencyFee,
                rushFee,
                tierFee,
                addOnsTotal,
                finalEstimate,
                condition: effectiveCondition,
                urgencyLevel: effectiveUrgencyLevel,
                isRush,
                rushFeeRate: isRush ? appSettings.rushFeeRate : 0,
                workerTier,
                distanceKm: workerDistanceKm,
                freeDistanceKm: appSettings.freeDistanceKm,
                perKmFee: appSettings.perKmFee,
                isAutoMatched,
              },
            },
          });

          return created;
        });

        await schedulePendingExpiry(booking.id).catch((error) => {
          console.error(`Failed to schedule pending-expiry for booking ${booking.id}:`, error);
        });

        await notifyUser({
          userId: booking.workerId as string,
          type: 'BOOKING_REQUEST',
          title: parentBookingId ? 'Follow-up Job Request' : isRush ? 'Same-day Booking Request' : 'New Booking Request',
          message: parentBookingId
            ? `${booking.client.fullName} is asking you for a follow-up job after your inspection`
            : `${booking.client.fullName} has requested your service`,
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
            scheduledTime: booking.scheduledTime,
            isRush,
            parentBookingId: booking.parentBookingId,
            workerTier,
            estimatedPrice: booking.estimatedPrice,
            estimatedDurationHours: booking.estimatedDurationHours,
            expiresAt: booking.expiresAt,
            pricing: {
              basePrice,
              conditionFee,
              distanceFee,
              urgencyFee,
              rushFee,
              tierFee,
              addOnsTotal,
              finalEstimate,
              addOns: addOnsList,
            },
            payment: null,
          },
        });
      } catch (txErr: any) {
        if (txErr.message === 'WORKER_NOT_FOUND') {
          return res.status(404).json(errorResponse(404, 'Worker not found'));
        }
        if (txErr.message === 'WORKER_NOT_APPROVED') {
          return res.status(403).json(errorResponse(403, 'Worker is not verified yet'));
        }
        if (txErr.code === 'P2002') {
          return res.status(409).json(
            errorResponse(409, 'This booking request is already being processed — check your bookings list.')
          );
        }
        throw txErr;
      }
    }
  } catch (error) {
    console.error('Error creating booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to create booking'));
  }
};

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
          payment: { select: { capturedAt: true } },
          addOns: { where: { clientApprovedAt: { not: null } }, select: { price: true } },
          group: { include: { bookings: { select: { id: true }, orderBy: { scheduledDate: 'asc' } } } },
          visits: {
            where: { status: 'SCHEDULED' },
            orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }],
            select: { id: true, scheduledDate: true, scheduledTime: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.booking.count({ where: whereClause }),
    ]);

    const { commissionRate, withholdingTaxRate } = await getAppSettings();

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
      scheduledTime: bookingStartTime(b),
      timeSlot: b.timeSlot,
      isRush: b.isRush,
      parentBookingId: b.parentBookingId ?? null,
      quoteStatus: b.quoteStatus ?? null,
      workerArrivedAt: b.workerArrivedAt ?? null,
      upcomingVisits: b.visits,
      urgencyLevel: b.urgencyLevel,
      rooms: b.rooms,
      condition: b.condition,
      quantity: b.quantity,
      location: b.location,
      city: b.city,
      distanceMeters: b.distanceMeters,
      estimatedPrice: b.estimatedPrice,
      finalPrice: b.finalPrice,
      tip: b.tip ?? 0,
      workerPayoutEstimate: calculateWorkerPayout(
        b.finalPrice ?? round2(b.estimatedPrice + (b.addOns ?? []).reduce((sum: number, a: { price: number }) => sum + a.price, 0)),
        b.tip ?? 0,
        commissionRate,
        withholdingTaxRate
      ),
      rating: b.review?.rating ?? null,
      completedAt: b.status === 'COMPLETED' ? (b.payment?.capturedAt ?? b.updatedAt) : null,
      groupId: b.groupId ?? null,
      groupTotalDays: b.group?.totalDays ?? null,
      groupDayIndex: b.group ? b.group.bookings.findIndex((gb: { id: string }) => gb.id === b.id) + 1 : null,
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
            workerProfile: { select: { kycStatus: true, currentLat: true, currentLng: true, lastLocationUpdate: true } },
          },
        },
        serviceTask: { include: { serviceType: { select: { name: true } } } },
        payment: true,
        parentBooking: {
          select: { id: true, scheduledDate: true, serviceType: true, serviceTask: { select: { name: true } } },
        },
        followUps: {
          select: { id: true, status: true, scheduledDate: true, serviceType: true, serviceTask: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        },
        visits: { orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }] },
        addOns: { orderBy: { createdAt: 'asc' } },
        quoteItems: { orderBy: { createdAt: 'asc' } },
        review: true,
        pricingLogs: { orderBy: { createdAt: 'asc' } },
        disputes: { orderBy: { createdAt: 'desc' } },
        arrivalVerification: true,
        cancellation: true,
        group: { include: { bookings: { orderBy: { scheduledDate: 'asc' } } } },
      },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    const isOwner = booking.clientId === req.user.userId || booking.workerId === req.user.userId;
    if (!isOwner && req.user.role !== 'ADMIN') {
      return res.status(403).json(errorResponse(403, 'You do not have permission to view this booking'));
    }
    const settings = await getAppSettings();

    const declineRecord =
      booking.status === 'REJECTED' && booking.workerId
        ? await prisma.declinedWorker.findUnique({
            where: { bookingId_workerId: { bookingId: booking.id, workerId: booking.workerId } },
            select: { reason: true, declinedAt: true },
          })
        : null;

    const addonsCost = (booking.addOns || [])
      .filter((addon: any) => addon.clientApprovedAt != null)
      .reduce((sum: number, addon: any) => sum + addon.price, 0);
    const hasQuote = booking.laborCost != null && booking.materialsCost != null;
    const finalPrice = hasQuote
      ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0) + addonsCost
      : booking.estimatedPrice + addonsCost;

    const breakdownTip = booking.payment?.tip ?? booking.tip ?? 0;
    const breakdownVat =
      booking.payment?.vatAmount ??
      (booking.vatApplicable ? round2(finalPrice * (booking.vatRate ?? VAT_RATE)) : (booking.vatAmount ?? 0));
    const bookingPricingLog = booking.pricingLogs[0] ?? null;
    const priceBreakdown = {
      ...itemizeBookingPrice(bookingPricingLog, booking),
      distanceFeeNote: describeDistanceFee(bookingPricingLog, settings),
      addOns: (booking.addOns || [])
        .filter((addon: any) => addon.clientApprovedAt != null)
        .map((addon: any) => ({ name: addon.name, price: addon.price })),
      subtotal: finalPrice,
      vatApplicable: booking.vatApplicable,
      vatRate: booking.vatRate,
      vatAmount: breakdownVat,
      tip: breakdownTip,
      total: booking.payment?.totalAmount ?? round2(finalPrice + breakdownVat + breakdownTip),
    };

    const isAssignedWorker = booking.workerId === req.user.userId;
    const nearbyJobs =
      isAssignedWorker && (booking.status === 'PENDING' || booking.status === 'ACCEPTED')
        ? await findNearbyJobs(prisma, booking.workerId!, booking.scheduledDate, bookingStartTime(booking), booking.id)
        : [];

    let earnings: {
      isEstimate: boolean;
      subtotal: number;
      tip: number;
      commissionRate: number | null;
      commissionAmount: number;
      withholdingTaxAmount: number;
      vatAmount: number;
      workerPayout: number;
    } | null = null;
    if (isAssignedWorker) {
      const p = booking.payment;
      if (p && p.workerPayout != null) {
        earnings = {
          isEstimate: false,
          subtotal: p.subtotal ?? finalPrice,
          tip: p.tip ?? 0,
          commissionRate: p.commissionRate ?? null,
          commissionAmount: p.commissionAmount ?? 0,
          withholdingTaxAmount: p.withholdingTaxAmount ?? 0,
          vatAmount: p.vatAmount ?? 0,
          workerPayout: p.workerPayout,
        };
      } else {
        earnings = {
          isEstimate: true,
          ...computeWorkerEarnings({
            subtotal: finalPrice,
            tip: breakdownTip,
            commissionRate: booking.commissionRateSnapshot ?? settings.commissionRate,
            withholdingTaxRate: booking.withholdingTaxRateSnapshot ?? settings.withholdingTaxRate,
            vatApplicable: booking.vatApplicable,
            vatRate: booking.vatRate,
          }),
        };
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Booking details retrieved successfully',
      data: {
        id: booking.id,
        earnings,
        parentBooking: booking.parentBooking
          ? {
              id: booking.parentBooking.id,
              scheduledDate: booking.parentBooking.scheduledDate,
              service: booking.parentBooking.serviceTask?.name ?? booking.parentBooking.serviceType,
            }
          : null,
        followUps: booking.followUps.map((f) => ({
          id: f.id,
          status: f.status,
          scheduledDate: f.scheduledDate,
          service: f.serviceTask?.name ?? f.serviceType,
        })),
        allowsFollowUp: booking.serviceTask?.allowsFollowUp ?? false,
        serviceTaskPricingModel: booking.serviceTask?.pricingModel ?? null,
        visits: booking.visits,
        nearbyJobs,
        groupId: booking.groupId,
        group: booking.group
          ? {
              totalDays: booking.group.totalDays,
              bookings: booking.group.bookings.map((gb: { id: string; scheduledDate: Date; status: string }) => ({
                id: gb.id,
                scheduledDate: gb.scheduledDate,
                status: gb.status,
              })),
            }
          : null,
        client: booking.client,
        worker: booking.worker
          ? {
              id: booking.worker.id,
              fullName: booking.worker.fullName,
              email: booking.worker.email,
              phone: booking.worker.phone,
              avatar: booking.worker.avatar,
              verified: booking.worker.workerProfile?.kycStatus === 'APPROVED',
              ...(booking.status === 'ACCEPTED' && !booking.workerArrivedAt
                ? {
                    currentLat: booking.worker.workerProfile?.currentLat ?? null,
                    currentLng: booking.worker.workerProfile?.currentLng ?? null,
                    lastLocationUpdate: booking.worker.workerProfile?.lastLocationUpdate ?? null,
                  }
                : { currentLat: null, currentLng: null, lastLocationUpdate: null }),
            }
          : null,
        service: booking.serviceTask?.name ?? booking.serviceType,
        category: booking.serviceTask?.serviceType?.name ?? booking.serviceType,
        status: booking.status,
        description: booking.description,
        location: booking.location,
        city: booking.city,
        clientLat: booking.clientLat,
        clientLng: booking.clientLng,
        scheduledDate: booking.scheduledDate,
        scheduledTime: bookingStartTime(booking),
        timeSlot: booking.timeSlot,
        isRush: booking.isRush,
        urgencyLevel: booking.urgencyLevel,
        rescheduledAt: booking.rescheduledAt,
        previousScheduledDate: booking.previousScheduledDate,
        previousTimeSlot: booking.previousTimeSlot,
        originalScheduledDate: booking.originalScheduledDate,
        originalTimeSlot: booking.originalTimeSlot,
        rescheduleAcknowledgedAt: booking.rescheduleAcknowledgedAt,
        rescheduleRequestedAt: booking.rescheduleRequestedAt,
        rescheduleRequestedBy: booking.rescheduleRequestedBy ?? (booking.rescheduleRequestedAt ? 'CLIENT' : null),
        requestedScheduledDate: booking.requestedScheduledDate,
        requestedScheduledTime:
          booking.requestedScheduledDate != null
            ? bookingStartTime({ scheduledTime: booking.requestedScheduledTime, timeSlot: booking.requestedTimeSlot })
            : null,
        requestedTimeSlot: booking.requestedTimeSlot,
        rescheduleRequestRespondedAt: booking.rescheduleRequestRespondedAt,
        rescheduleRequestAccepted: booking.rescheduleRequestAccepted,
        workerNoShowFlaggedAt: booking.workerNoShowFlaggedAt,
        clientNotHereAt: booking.clientNotHereAt,
        clientNoShowCancelAt: booking.clientNotHereAt
          ? ((await clientNoShowCancelAt(booking, settings.noShowGraceMinutes))?.toISOString() ?? null)
          : null,
        clientFaultFeeAmount: settings.clientFaultCompensationAmount,
        noShowGraceMinutes: settings.noShowGraceMinutes,
        cancelRequestedAt: booking.cancelRequestedAt,
        cancelRequestReason: booking.cancelRequestReason,
        cancelRequestEscalatedAt: booking.cancelRequestEscalatedAt,
        hasOpenDispute: booking.disputes.some((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW'),
        rooms: booking.rooms,
        condition: booking.condition,
        scopeAnswers: booking.scopeAnswers,
        quantity: booking.quantity,
        quantityUnit: booking.serviceTask?.unitLabel ?? null,
        priorities: booking.priorities,
        isAutoMatched: booking.isAutoMatched,
        estimatedPrice: booking.estimatedPrice,
        finalPrice,
        vatApplicable: booking.vatApplicable,
        vatRate: booking.vatRate,
        priceBreakdown,
        tip: booking.tip,
        completionPhotoUrl: booking.completionPhotoUrl,
        beforePhotoUrls: booking.beforePhotoUrls,
        progressPhotoUrls: booking.progressPhotoUrls,
        estimatedDurationHours: booking.estimatedDurationHours,
        inspectionFeeCharged: booking.inspectionFeeCharged,
        inspectionFeeAmount: booking.inspectionFeeAmount,
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
        invoice: {
          status: invoiceStatus(booking.status, booking.workerCompletedAt),
          sentAt: booking.workerCompletedAt,
          lines: invoiceLines(booking),
          subtotal: finalPrice,
          vatAmount: breakdownVat,
          tip: breakdownTip,
          total: priceBreakdown.total,
        },
        addOns: booking.addOns,
        review: booking.review,
        notes: booking.notes,
        // Chronological milestones for a status-progress UI.
        timeline: {
          createdAt: booking.createdAt,
          acceptedAt: booking.acceptedAt,
          workerArrivedAt: booking.workerArrivedAt,
          workerStartedAt: booking.workerStartedAt,
          workerCompletedAt: booking.workerCompletedAt,
          completionDate: booking.completionDate,
        },
        pricingLogs: booking.pricingLogs,
        disputes: booking.disputes,
        arrivalVerification: booking.arrivalVerification,
        cancellation: booking.cancellation,
        declineReason: declineRecord?.reason ?? null,
        declinedAt: declineRecord?.declinedAt ?? null,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching booking detail:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch booking details'));
  }
};

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

    if (booking.parentBookingId && req.body?.confirmFollowUp !== true) {
      return res.status(400).json({
        ...errorResponse(400, 'Confirm that you will do this follow-up job'),
        code: 'FOLLOW_UP_CONFIRMATION_REQUIRED',
      });
    }

    if (!(await getWorkerSetupStatus(currentUserId))?.complete) {
      return res.status(403).json({ ...errorResponse(403, WORKER_SETUP_INCOMPLETE_MESSAGE), code: 'WORKER_SETUP_INCOMPLETE' });
    }

    // Wrap in transaction to prevent double-counting
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "WorkerProfile" WHERE "userId" = ${currentUserId} FOR UPDATE`;

        // Check current capacity
        const workerProfile = await tx.workerProfile.findUnique({
          where: { userId: currentUserId },
        });

        if (!workerProfile) {
          throw new Error('Worker profile not found');
        }

        if (workerProfile.debtHoldAt) {
          throw new Error('ACCOUNT_ON_HOLD');
        }

        const sameDayJobs = await tx.booking.findMany({
          where: {
            workerId: currentUserId,
            id: { not: id },
            scheduledDate: booking.scheduledDate,
            status: { in: ['ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED'] },
          },
          select: { scheduledTime: true, timeSlot: true },
        });
        const myStart = bookingStartTime(booking);
        if (sameDayJobs.some((job) => bookingStartTime(job) === myStart)) {
          throw new Error('START_TIME_CLASH');
        }

        const { commissionRate, withholdingTaxRate, workerDebtHoldLimit } = await getAppSettings();

        let debtWarning: string | null = null;
        if (booking.paymentMethodType === 'CASH' && workerDebtHoldLimit > 0) {
          const projectedCommission = calculateCommission(booking.estimatedPrice, commissionRate);
          const projectedWithholding = calculateWithholdingTax(booking.estimatedPrice, commissionRate, withholdingTaxRate);
          const projectedCut = Math.round((projectedCommission + projectedWithholding) * 100) / 100;
          const projectedOwed = Math.round((workerProfile.commissionOwed + projectedCut) * 100) / 100;
          if (projectedOwed >= workerDebtHoldLimit) {
            debtWarning =
              `Completing this cash job will add ~₱${projectedCut.toFixed(2)} to your platform dues ` +
              `(₱${projectedOwed.toFixed(2)} of ₱${workerDebtHoldLimit.toFixed(2)}) and may put your account on hold.`;
          }
        }

        await updateBookingIfStatus(tx, id, 'PENDING', {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          commissionRateSnapshot: commissionRate,
          withholdingTaxRateSnapshot: withholdingTaxRate,
        });
        const updated = await tx.booking.findUniqueOrThrow({ where: { id } });

        await tx.workerProfile.update({
          where: { userId: currentUserId },
          data: { activeJobCount: { increment: 1 } },
        });

        return { booking: updated, debtWarning };
      });

      await cancelPendingExpiryJob(id).catch((error) => {
        console.error('Failed to cancel pending-expiry job for accepted booking %s:', id, error);
      });

      // Create notification for client
      await notifyUser({
        userId: result.booking.clientId,
        type: 'BOOKING_ACCEPTED',
        title: 'Booking Accepted',
        message: 'Your booking has been accepted',
        relatedId: result.booking.id,
      });

      void sendSmsToUser({
        userId: result.booking.clientId,
        message: `HomeEase: Your booking (${formatDisplayId(result.booking.id)}) has been accepted by the worker. Open the app for details.`,
      });

      return res.status(200).json({
        success: true,
        message: 'Booking accepted successfully',
        data: {
          id: result.booking.id,
          status: result.booking.status,
          debtWarning: result.debtWarning,
        },
      });
    } catch (txError: any) {
      if (txError.message === 'ACCOUNT_ON_HOLD') {
        return res.status(402).json(
          errorResponse(
            402,
            'Your account is on hold due to outstanding platform dues. Please contact support to continue accepting jobs.'
          )
        );
      }
      if (txError.message === 'START_TIME_CLASH') {
        // 409, not 403, for the same logout reason as above.
        return res.status(409).json({
          ...errorResponse(409, `You already have a job starting at ${formatTime12h(bookingStartTime(booking))} that day. Decline this one, or ask that client to reschedule first.`),
          code: 'START_TIME_CLASH',
        });
      }
      throw txError;
    }
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error accepting booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to accept booking'));
  }
};

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

      await updateBookingIfStatus(tx, id, 'PENDING', {
        status: 'REJECTED',
        declinedWorkerIds: updatedDeclinedWorkerIds,
      });
      return tx.booking.findUniqueOrThrow({ where: { id } });
    });

    await cancelPendingExpiryJob(id).catch((error) => {
      console.error('Failed to cancel pending-expiry job for declined booking %s:', id, error);
    });
    await requestRefund({ bookingId: id, reason: 'WORKER_DECLINED', source: 'BOOKING_CANCELLED', requestedById: workerId }).catch(
      (error) => {
        console.error('Failed to void/refund-request payment for declined booking %s:', id, error);
      }
    );

    await writeAuditLog({
      actorId: workerId,
      actorName: req.user.email,
      actorRole: req.user.role,
      action: 'BOOKING_DECLINED',
      category: 'STATUS_CHANGE',
      message: `Worker declined booking ${formatDisplayId(id)}`,
      metadata: { bookingId: id, workerId },
    });

    const alternatives = await findAutoMatchWorker({
      serviceType: updated.serviceType,
      serviceTaskId: updated.serviceTaskId,
      date: updated.scheduledDate,
      excludeWorkerIds: [...updatedDeclinedWorkerIds, ...(await blockedUserIds(updated.clientId))],
      clientLat: updated.clientLat,
      clientLng: updated.clientLng,
    }).catch(() => null);

    const declineReason = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
    const decliner = await prisma.user.findUnique({ where: { id: workerId }, select: { fullName: true } });
    const declinerName = decliner?.fullName || 'The worker';
    await notifyUser({
      userId: updated.clientId,
      type: 'BOOKING_REJECTED',
      title: 'Booking Declined',
      message: declineReason
        ? `${declinerName} declined your booking request. Reason: ${declineReason}`
        : `${declinerName} declined your booking request`,
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
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error declining booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to decline booking'));
  }
};

const MAX_ARRIVAL_ACCURACY_METERS = 100;

export const arriveBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can check in as arrived'));
    }

    const id = req.params.id as string;
    const { lat, lng, accuracy, mocked } = req.body as {
      lat: number;
      lng: number;
      accuracy?: number | null;
      mocked?: boolean | null;
    };

    if (mocked === true) {
      return res.status(409).json(
        errorResponse(409, 'Mock location detected — disable any mock-location app or GPS spoofing tool to check in')
      );
    }

    if (accuracy != null && accuracy > MAX_ARRIVAL_ACCURACY_METERS) {
      return res.status(409).json(
        errorResponse(
          409,
          `Your location signal is too imprecise to check in (±${Math.round(accuracy)}m) — move to an area with a clearer GPS signal and try again`
        )
      );
    }

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

    if (booking.workerArrivedAt) {
      const arrival = await prisma.arrivalVerification.findUnique({ where: { bookingId: id } });
      return res.status(200).json({
        success: true,
        message: 'Already checked in',
        data: {
          id: booking.id,
          workerArrivedAt: booking.workerArrivedAt,
          arrivalVerification: arrival && {
            id: arrival.id,
            distanceMeters: arrival.distanceMeters,
            isVerified: arrival.isVerified,
            isOutsideBookedWindow: arrival.isOutsideBookedWindow,
            createdAt: arrival.createdAt,
          },
        },
      });
    }

    const { geofenceRadiusMeters, noShowGraceMinutes } = await getAppSettings();
    const clientLocation = { lat: booking.clientLat, lng: booking.clientLng };
    const workerLocation = { lat, lng };
    const distance = distanceMeters(clientLocation, workerLocation);
    const isVerified =
      geofenceRadiusMeters === 0 || isWithinRadiusMeters(clientLocation, workerLocation, geofenceRadiusMeters);

    if (!isVerified) {
      return res.status(409).json(
        errorResponse(409, `You are ${Math.round(distance)}m from the job site — must be within ${geofenceRadiusMeters}m to check in`)
      );
    }

    const arrivedAt = new Date();
    const outsideWindow = isOutsideBookedWindow(bookingStartInstant(booking), arrivedAt, noShowGraceMinutes);

    const [arrival, updated] = await prisma.$transaction([
      prisma.arrivalVerification.create({
        data: {
          bookingId: id,
          workerLat: lat,
          workerLng: lng,
          distanceMeters: distance,
          isVerified: true,
          isOutsideBookedWindow: outsideWindow,
          mockedLocation: false,
        },
      }),
      prisma.booking.update({
        where: { id },
        data: { workerArrivedAt: arrivedAt, workerLat: lat, workerLng: lng },
      }),
      prisma.workerProfile.update({
        where: { userId: req.user.userId },
        data: { currentLat: null, currentLng: null, lastLocationUpdate: null },
      }),
    ]);

    await notifyUser({
      userId: updated.clientId,
      type: 'BOOKING_ARRIVED',
      title: 'Worker Has Arrived',
      message: 'Your worker has checked in at the job site.',
      relatedId: id,
    });

    if (outsideWindow) {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
      await Promise.all(
        admins.map((admin) =>
          notifyUser({
            userId: admin.id,
            type: 'BOOKING_ARRIVAL_FLAGGED',
            title: 'Arrival Outside Booked Window',
            message: `Worker checked in for booking ${formatDisplayId(id)} outside its booked date/time — flagged for review.`,
            relatedId: id,
          })
        )
      );
      await writeAuditLog({
        actorId: req.user.userId,
        actorRole: req.user.role,
        action: 'ARRIVAL_OUTSIDE_BOOKED_WINDOW',
        category: 'STATUS_CHANGE',
        message: `Worker checked in for booking ${formatDisplayId(id)} outside its booked date/time window`,
        metadata: { bookingId: id, scheduledDate: booking.scheduledDate.toISOString(), scheduledTime: bookingStartTime(booking), arrivedAt: arrivedAt.toISOString() },
      });
    }

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
          isOutsideBookedWindow: arrival.isOutsideBookedWindow,
          createdAt: arrival.createdAt,
        },
      },
    });
  } catch (error) {
    console.error('Error verifying arrival:', error);
    return res.status(500).json(errorResponse(500, 'Failed to verify arrival'));
  }
};

async function clientNoShowCancelAt(
  booking: Pick<Booking, 'id' | 'scheduledDate' | 'scheduledTime' | 'timeSlot' | 'clientNotHereAt'>,
  graceMinutes: number
): Promise<Date | null> {
  const { clientNotHereAt } = booking;
  if (!clientNotHereAt) return null;
  const arrival = await prisma.arrivalVerification.findUnique({
    where: { bookingId: booking.id },
    select: { isOutsideBookedWindow: true },
  });
  if (arrival?.isOutsideBookedWindow) return null;
  return clientNoShowDeadline({ ...booking, clientNotHereAt }, graceMinutes);
}

export const reportClientNotHere = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const id = req.params.id as string;
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }
    if (booking.status !== 'ACCEPTED') {
      return res.status(409).json(errorResponse(409, `Cannot alert the client for booking with status ${booking.status}`));
    }
    if (!booking.workerArrivedAt) {
      return res.status(409).json(errorResponse(409, 'Check in at the job site first'));
    }

    const { noShowGraceMinutes } = await getAppSettings();
    let clientNotHereAt = booking.clientNotHereAt;
    let alertNow = false;
    if (!clientNotHereAt) {
      const now = new Date();
      try {
        await updateBookingIfStatus(prisma, id, 'ACCEPTED', { clientNotHereAt: now }, { clientNotHereAt: null });
        clientNotHereAt = now;
        alertNow = true;
      } catch (error) {
        if (!isBookingStatusConflict(error)) throw error;
        // A parallel tap won: answer like a repeat call.
        const fresh = await prisma.booking.findUnique({ where: { id }, select: { status: true, clientNotHereAt: true } });
        if (fresh?.status !== 'ACCEPTED' || !fresh.clientNotHereAt) return bookingConflict(res);
        clientNotHereAt = fresh.clientNotHereAt;
      }
    }
    if (alertNow) {
      const message = "Your worker checked in and can't reach you. Please come to the door or message them.";
      await notifyUser({
        userId: booking.clientId,
        type: 'BOOKING_CLIENT_NOT_HERE',
        title: 'Your worker is at your door',
        message,
        relatedId: id,
      });
      void sendSmsToUser({ userId: booking.clientId, message: `HomeEase ${formatDisplayId(id)}: ${message}` });
    }

    return res.status(200).json({
      success: true,
      message: 'The client has been alerted',
      data: {
        clientNotHereAt: clientNotHereAt.toISOString(),
        canCancelAt: (await clientNoShowCancelAt({ ...booking, clientNotHereAt }, noShowGraceMinutes))?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error alerting client:', error);
    return res.status(500).json(errorResponse(500, 'Failed to alert the client'));
  }
};

export const updateWorkerLiveLocation = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can share live location'));
    }

    const id = req.params.id as string;
    const { lat, lng, accuracy } = req.body as { lat: number; lng: number; accuracy?: number };

    const booking = await prisma.booking.findUnique({ where: { id }, select: { workerId: true, clientId: true, status: true } });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }

    if (booking.status !== 'ACCEPTED') {
      return res.status(409).json(errorResponse(409, `Cannot share live location for booking with status ${booking.status}`));
    }

    const now = new Date();
    await prisma.workerProfile.update({
      where: { userId: req.user.userId },
      data: { currentLat: lat, currentLng: lng, lastLocationUpdate: now },
    });

    getIO().to(booking.clientId).emit('worker:location', {
      bookingId: id,
      lat,
      lng,
      accuracy: accuracy ?? null,
      at: now.toISOString(),
    });

    return res.status(200).json({ success: true, message: 'Location shared' });
  } catch (error) {
    console.error('Error updating worker live location:', error);
    return res.status(500).json(errorResponse(500, 'Failed to update live location'));
  }
};

export const startBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can start bookings'));
    }

    const id = req.params.id as string;

    const booking = await prisma.booking.findUnique({ where: { id } });

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

    const beforePhotoUrls = toOwnedBookingPhotoUrls(req.body?.beforePhotoUrls ?? [], req.user.userId);
    if (!beforePhotoUrls) {
      return res.status(400).json(errorResponse(400, 'Upload the before photos again — one of them could not be verified'));
    }
    if (beforePhotoUrls.length > MAX_PROOF_PHOTOS) {
      return res.status(400).json(errorResponse(400, `Add at most ${MAX_PROOF_PHOTOS} photos of the job before you start`));
    }

    await updateBookingIfStatus(prisma, id, booking.status, {
      status: 'IN_PROGRESS',
      workerStartedAt: new Date(),
      beforePhotoUrls,
    });
    const updated = await prisma.booking.findUniqueOrThrow({ where: { id } });

    // Notify client
    await notifyUser({
      userId: updated.clientId,
      type: 'BOOKING_STARTED',
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
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error starting booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to start booking'));
  }
};

const VISIT_ALLOWED_STATUSES = ['IN_PROGRESS'];

export const scheduleVisit = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can schedule a follow-up visit'));
    }

    const id = req.params.id as string;
    const { date, time, notes } = req.body as { date: string; time: string; notes?: string | null };

    const booking = await prisma.booking.findUnique({ where: { id }, select: { id: true, workerId: true, clientId: true, status: true } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }
    if (!VISIT_ALLOWED_STATUSES.includes(booking.status)) {
      return res.status(409).json(errorResponse(409, 'You can schedule a follow-up visit while the job is in progress'));
    }

    const startCheck = checkBookingStart(date, time, 0);
    if (!startCheck.ok) {
      return res.status(400).json(errorResponse(400, startCheck.message));
    }

    const scheduledDate = toDayStart(date);
    const visit = await prisma.bookingVisit.create({
      data: { bookingId: id, scheduledDate, scheduledTime: time, notes: notes?.trim() || null },
    });

    const nearbyJobs = await findNearbyJobs(prisma, req.user.userId, scheduledDate, time, id);

    const when = `${scheduledDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })} at ${formatTime12h(time)}`;
    await notifyUser({
      userId: booking.clientId,
      type: 'FOLLOW_UP_VISIT_SCHEDULED',
      title: 'Follow-up Visit Scheduled',
      message: `Your worker needs another visit to finish the job: ${when}.${visit.notes ? ` Note: ${visit.notes}` : ''}`,
      relatedId: id,
    });

    await writeAuditLog({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: 'BOOKING_VISIT_SCHEDULED',
      category: 'STATUS_CHANGE',
      message: `Follow-up visit scheduled for booking ${formatDisplayId(id)} on ${isoDay(scheduledDate)} ${time}`,
      metadata: { bookingId: id, visitId: visit.id },
    });

    return res.status(201).json({
      success: true,
      message: 'Follow-up visit scheduled',
      data: { visit, nearbyJobs },
    });
  } catch (error) {
    console.error('Error scheduling follow-up visit:', error);
    return res.status(500).json(errorResponse(500, 'Failed to schedule the follow-up visit'));
  }
};

export const cancelVisit = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can cancel a follow-up visit'));
    }

    const { id, visitId } = req.params as { id: string; visitId: string };
    const visit = await prisma.bookingVisit.findUnique({
      where: { id: visitId },
      include: { booking: { select: { workerId: true, clientId: true } } },
    });
    if (!visit || visit.bookingId !== id) {
      return res.status(404).json(errorResponse(404, 'Visit not found'));
    }
    if (visit.booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }
    if (visit.status !== 'SCHEDULED') {
      return res.status(409).json(errorResponse(409, 'This visit is no longer scheduled'));
    }

    const updated = await prisma.bookingVisit.update({ where: { id: visitId }, data: { status: 'CANCELLED' } });

    await notifyUser({
      userId: visit.booking.clientId,
      type: 'FOLLOW_UP_VISIT_SCHEDULED',
      title: 'Follow-up Visit Cancelled',
      message: `Your worker cancelled the follow-up visit on ${visit.scheduledDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })}.`,
      relatedId: id,
    });

    return res.status(200).json({ success: true, message: 'Visit cancelled', data: updated });
  } catch (error) {
    console.error('Error cancelling follow-up visit:', error);
    return res.status(500).json(errorResponse(500, 'Failed to cancel the visit'));
  }
};

export const acknowledgeReschedule = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only the client can acknowledge a reschedule'));
    }

    const id = req.params.id as string;
    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking does not belong to you'));
    }
    if (booking.rescheduledAt == null) {
      return res.status(409).json(errorResponse(409, 'This booking has not been rescheduled'));
    }
    if (booking.rescheduleAcknowledgedAt != null) {
      return res.status(409).json(errorResponse(409, 'This reschedule has already been acknowledged'));
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { rescheduleAcknowledgedAt: new Date() },
    });

    if (booking.workerId) {
      await notifyUser({
        userId: booking.workerId,
        type: 'BOOKING_RESCHEDULE_CONFIRMED',
        title: 'New Date Confirmed',
        message: 'The client confirmed the new date for this booking.',
        relatedId: id,
      });
    }

    await writeAuditLog({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: 'BOOKING_RESCHEDULE_ACKNOWLEDGED',
      category: 'STATUS_CHANGE',
      message: `Client confirmed the new date for booking ${formatDisplayId(id)}`,
      metadata: { bookingId: id },
    });

    return res.status(200).json({
      success: true,
      message: 'New date confirmed',
      data: { id: updated.id, scheduledDate: updated.scheduledDate, timeSlot: updated.timeSlot },
    });
  } catch (error) {
    console.error('Error acknowledging reschedule:', error);
    return res.status(500).json(errorResponse(500, 'Failed to acknowledge reschedule'));
  }
};

export const requestReschedule = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || (req.user.role !== 'CLIENT' && req.user.role !== 'WORKER')) {
      return res.status(403).json(errorResponse(403, 'Only the client or the worker can request a reschedule'));
    }

    const id = req.params.id as string;
    const { date, time } = req.body as { date: string; time: string };

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    const isClient = req.user.role === 'CLIENT';
    if ((isClient && booking.clientId !== req.user.userId) || (!isClient && booking.workerId !== req.user.userId)) {
      return res.status(403).json(errorResponse(403, 'This booking is not yours'));
    }
    if (booking.status !== 'ACCEPTED') {
      return res.status(409).json(errorResponse(409, `Cannot request a reschedule for a booking with status ${booking.status}`));
    }
    if (!booking.workerId) {
      return res.status(409).json(errorResponse(409, 'This booking has no assigned worker'));
    }
    if (booking.workerArrivedAt != null) {
      return res.status(409).json(errorResponse(409, 'The worker has already arrived, so this booking can no longer be rescheduled'));
    }
    if (booking.rescheduleRequestedAt != null && booking.rescheduleRequestRespondedAt == null) {
      return res.status(409).json(errorResponse(409, 'There is already a pending reschedule request for this booking'));
    }

    const { rushMinLeadHours } = await getAppSettings();
    const startCheck = checkBookingStart(date, time, rushMinLeadHours);
    if (!startCheck.ok) {
      return res.status(400).json(errorResponse(400, startCheck.message));
    }

    const requestedDate = toDayStart(date);
    if (requestedDate.getTime() === toDayStart(booking.scheduledDate).getTime() && time === bookingStartTime(booking)) {
      return res.status(400).json(errorResponse(400, "That is already this booking's date and time"));
    }

    // A client can only propose a day the worker works.
    if (isClient) {
      const workerProfile = await prisma.workerProfile.findUnique({
        where: { userId: booking.workerId },
        select: { id: true, availableDays: true },
      });
      if (!workerProfile) {
        return res.status(404).json(errorResponse(404, 'Worker profile not found'));
      }
      if (!(await isWorkerAvailableOn(prisma, workerProfile, requestedDate))) {
        return res.status(409).json(errorResponse(409, "Your worker isn't working on that date"));
      }
    }

    await updateBookingIfStatus(prisma, id, 'ACCEPTED', {
      requestedScheduledDate: requestedDate,
      requestedScheduledTime: time,
      requestedTimeSlot: null,
      rescheduleRequestedBy: isClient ? 'CLIENT' : 'WORKER',
      rescheduleRequestedAt: new Date(),
      rescheduleRequestReminderSentAt: null,
      rescheduleRequestRespondedAt: null,
      rescheduleRequestAccepted: null,
    }, {
      workerArrivedAt: null,
      OR: [{ rescheduleRequestedAt: null }, { rescheduleRequestRespondedAt: { not: null } }],
    });

    const when = `${requestedDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })} at ${formatTime12h(time)}`;
    await notifyUser({
      userId: isClient ? booking.workerId : booking.clientId,
      type: 'BOOKING_RESCHEDULE_REQUESTED',
      title: 'Reschedule Requested',
      message: isClient
        ? `Your client asked to move this booking to ${when}. Review and accept or decline.`
        : `Your worker asked to move this booking to ${when}. Review and accept or decline.`,
      relatedId: id,
    });

    await writeAuditLog({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: 'BOOKING_RESCHEDULE_REQUESTED',
      category: 'STATUS_CHANGE',
      message: `${isClient ? 'Client' : 'Worker'} requested a reschedule for booking ${formatDisplayId(id)} to ${isoDay(requestedDate)} ${time}`,
      metadata: { bookingId: id, requestedDate: requestedDate.toISOString(), time },
    });

    return res.status(200).json({
      success: true,
      message: isClient ? 'Reschedule requested — waiting for your worker to respond' : 'Reschedule requested — waiting for the client to respond',
      data: { id, requestedScheduledDate: requestedDate, requestedScheduledTime: time },
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error requesting reschedule:', error);
    return res.status(500).json(errorResponse(500, 'Failed to request reschedule'));
  }
};

function rescheduleRequester(booking: { rescheduleRequestedBy: string | null }): 'CLIENT' | 'WORKER' {
  return booking.rescheduleRequestedBy === 'WORKER' ? 'WORKER' : 'CLIENT';
}

export const withdrawRescheduleRequest = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const id = req.params.id as string;
    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.rescheduleRequestedAt == null || booking.rescheduleRequestRespondedAt != null) {
      return res.status(409).json(errorResponse(409, 'There is no pending reschedule request to withdraw'));
    }
    const requesterId = rescheduleRequester(booking) === 'CLIENT' ? booking.clientId : booking.workerId;
    if (requesterId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'Only the side that asked can withdraw this request'));
    }

    const { count } = await prisma.booking.updateMany({
      where: { id, rescheduleRequestedAt: booking.rescheduleRequestedAt, rescheduleRequestRespondedAt: null },
      data: { rescheduleRequestRespondedAt: new Date(), rescheduleRequestAccepted: null },
    });
    if (count === 0) {
      return res.status(409).json(errorResponse(409, 'There is no pending reschedule request to withdraw'));
    }

    const otherId = requesterId === booking.clientId ? booking.workerId : booking.clientId;
    if (otherId) {
      await notifyUser({
        userId: otherId,
        type: 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
        title: 'Reschedule Request Withdrawn',
        message: 'The reschedule request was withdrawn — the booking stays as originally scheduled.',
        relatedId: id,
      });
    }

    return res.status(200).json({ success: true, message: 'Reschedule request withdrawn', data: { id } });
  } catch (error) {
    console.error('Error withdrawing reschedule request:', error);
    return res.status(500).json(errorResponse(500, 'Failed to withdraw reschedule request'));
  }
};

export const respondToRescheduleRequest = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const id = req.params.id as string;
    const { accept } = req.body as { accept?: boolean };
    if (typeof accept !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'accept must be true or false'));
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.rescheduleRequestedAt == null || booking.rescheduleRequestRespondedAt != null) {
      return res.status(409).json(errorResponse(409, 'There is no pending reschedule request to respond to'));
    }
    const requester = rescheduleRequester(booking);
    const responderId = requester === 'CLIENT' ? booking.workerId : booking.clientId;
    if (responderId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'Only the other side can respond to this request'));
    }
    if (!booking.requestedScheduledDate || (!booking.requestedScheduledTime && !booking.requestedTimeSlot)) {
      return res.status(409).json(errorResponse(409, 'This reschedule request is missing its requested date/time'));
    }
    if (accept && booking.status !== 'ACCEPTED') {
      return res.status(409).json(errorResponse(409, 'This booking can no longer be moved'));
    }

    const newTime = bookingStartTime({ scheduledTime: booking.requestedScheduledTime, timeSlot: booking.requestedTimeSlot });

    if (accept) {
      if (booking.workerArrivedAt != null) {
        return res.status(409).json(errorResponse(409, 'The worker has already arrived, so this booking can no longer be moved'));
      }
      const { rushMinLeadHours } = await getAppSettings();
      const startCheck = checkBookingStart(isoDay(booking.requestedScheduledDate), newTime, rushMinLeadHours);
      if (!startCheck.ok) {
        return res.status(409).json(errorResponse(409, 'The proposed time has already passed or is too soon. Please decline and ask for a new time.'));
      }
      if (requester === 'CLIENT' && booking.workerId) {
        const workerProfile = await prisma.workerProfile.findUnique({
          where: { userId: booking.workerId },
          select: { id: true, availableDays: true },
        });
        if (!workerProfile || !(await isWorkerAvailableOn(prisma, workerProfile, booking.requestedScheduledDate))) {
          return res.status(409).json(errorResponse(409, "You're no longer available on the proposed date. Please decline this request."));
        }
      }

      const requestedDate = booking.requestedScheduledDate;
      await prisma.$transaction(async (tx) => {
        if (booking.workerId) {
          await tx.$queryRaw`SELECT "id" FROM "WorkerProfile" WHERE "userId" = ${booking.workerId} FOR UPDATE`;
          const sameDayJobs = await tx.booking.findMany({
            where: {
              workerId: booking.workerId,
              id: { not: id },
              scheduledDate: requestedDate,
              status: { in: ['ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED'] },
            },
            select: { scheduledTime: true, timeSlot: true },
          });
          if (sameDayJobs.some((job) => bookingStartTime(job) === newTime)) {
            throw new Error('START_TIME_CLASH');
          }
        }

        await updateBookingIfStatus(tx, id, 'ACCEPTED', {
          scheduledDate: requestedDate,
          scheduledTime: newTime,
          timeSlot: null,
          // The new start time resets the no-show clock.
          workerNoShowFlaggedAt: null,
          rescheduleRequestRespondedAt: new Date(),
          rescheduleRequestAccepted: true,
        }, {
          workerArrivedAt: null,
          rescheduleRequestedAt: booking.rescheduleRequestedAt,
          rescheduleRequestRespondedAt: null,
        });
      });
    } else {
      const { count } = await prisma.booking.updateMany({
        where: { id, rescheduleRequestedAt: booking.rescheduleRequestedAt, rescheduleRequestRespondedAt: null },
        data: { rescheduleRequestRespondedAt: new Date(), rescheduleRequestAccepted: false },
      });
      if (count === 0) {
        return res.status(409).json(errorResponse(409, 'There is no pending reschedule request to respond to'));
      }
    }

    const requesterId = requester === 'CLIENT' ? booking.clientId : booking.workerId;
    if (requesterId) {
      await notifyUser({
        userId: requesterId,
        type: accept ? 'BOOKING_RESCHEDULE_REQUEST_ACCEPTED' : 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
        title: accept ? 'Reschedule Accepted' : 'Reschedule Declined',
        message: accept
          ? `The new date for your booking was accepted.`
          : requester === 'WORKER'
            ? 'The client kept the original date and time. Please arrive on time — a no-show is cancelled with a penalty.'
            : 'Your worker could not take the new date — your booking stays as originally scheduled.',
        relatedId: id,
      });
    }

    await writeAuditLog({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: accept ? 'BOOKING_RESCHEDULE_REQUEST_ACCEPTED' : 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
      category: 'STATUS_CHANGE',
      message: `${req.user.role === 'WORKER' ? 'Worker' : 'Client'} ${accept ? 'accepted' : 'declined'} the reschedule request for booking ${formatDisplayId(id)}`,
      metadata: { bookingId: id },
    });

    return res.status(200).json({
      success: true,
      message: accept ? 'Reschedule accepted' : 'Reschedule declined',
      data: { id },
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    if (error instanceof Error && error.message === 'START_TIME_CLASH') {
      return res.status(409).json({
        ...errorResponse(
          409,
          req.user?.role === 'WORKER'
            ? 'You already have a job starting at that time on that day. Decline this request, or ask the client for a different time.'
            : 'Your worker already has another job starting at that time. Decline this request and suggest a different time.'
        ),
        code: 'START_TIME_CLASH',
      });
    }
    console.error('Error responding to reschedule request:', error);
    return res.status(500).json(errorResponse(500, 'Failed to respond to reschedule request'));
  }
};

const MAX_PROOF_PHOTOS = 5;
const MAX_PROGRESS_PHOTOS = 20;

const JOB_PHOTO_KINDS = {
  before: {
    field: 'beforePhotoUrls',
    max: MAX_PROOF_PHOTOS,
    label: 'before photos',
    notice: 'Your worker posted a photo of the job before starting work.',
  },
  progress: {
    field: 'progressPhotoUrls',
    max: MAX_PROGRESS_PHOTOS,
    label: 'progress photos',
    notice: 'Your worker posted a progress photo of the job.',
  },
} as const;

export const addBeforePhotos = (req: AuthRequest, res: Response) => addJobPhotos(req, res, 'before');

export const addProgressPhotos = (req: AuthRequest, res: Response) => addJobPhotos(req, res, 'progress');

async function addJobPhotos(req: AuthRequest, res: Response, kind: keyof typeof JOB_PHOTO_KINDS) {
  const { field, max, label, notice } = JOB_PHOTO_KINDS[kind];
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, `Only workers can post ${label}`));
    }
    const id = req.params.id as string;
    const workerId = req.user.userId;
    const photoUrls = toOwnedBookingPhotoUrls(req.body?.photoUrls, workerId);
    if (!photoUrls) {
      return res.status(400).json(errorResponse(400, 'Upload the photos again — one of them could not be verified'));
    }
    if (photoUrls.length === 0 || photoUrls.length > MAX_PROOF_PHOTOS) {
      return res.status(400).json(errorResponse(400, `Add 1 to ${MAX_PROOF_PHOTOS} photos`));
    }

    const result = await prisma.$transaction(async (tx) => {
      const booking = await lockBooking(tx, id);
      if (!booking || booking.workerId !== workerId) return { status: 404, message: 'Booking not found' } as const;
      if (booking.status !== 'IN_PROGRESS') {
        return { status: 409, message: `The ${label} can only be posted while the job is in progress` } as const;
      }
      if (booking[field].length + photoUrls.length > max) {
        return { status: 409, message: `A job can have at most ${max} ${label}` } as const;
      }
      const updated = await tx.booking.update({
        where: { id },
        data: { [field]: { push: photoUrls } },
        select: { beforePhotoUrls: true, progressPhotoUrls: true },
      });
      return { status: 201, updated, clientId: booking.clientId } as const;
    });
    if (result.status !== 201) {
      return res.status(result.status).json(errorResponse(result.status, result.message));
    }
    const { updated, clientId } = result;

    await notifyUser({
      userId: clientId,
      type: 'BOOKING_ACCEPTED',
      title: 'Job update',
      message: notice,
      relatedId: id,
    });

    return res.status(201).json({ success: true, data: updated });
  } catch (error) {
    console.error(`Error adding ${label}:`, error);
    return res.status(500).json(errorResponse(500, `Failed to post ${label}`));
  }
}

export const completeBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can complete bookings'));
    }

    const id = req.params.id as string;
    const workerId = req.user.userId;
    const { completionPhotoUrl } = req.body as { completionPhotoUrl?: string };

    if (!completionPhotoUrl || typeof completionPhotoUrl !== 'string') {
      return res.status(400).json(errorResponse(400, 'A completion photo is required to complete this job'));
    }

    const parsed = validateInvoiceItems(req.body?.items);
    if (!parsed.ok) {
      return res.status(400).json(errorResponse(400, parsed.error));
    }
    const items: InvoiceItemInput[] = [];
    for (const item of parsed.items) {
      const photoUrls = toOwnedBookingPhotoUrls(item.photoUrls, workerId);
      if (!photoUrls) {
        return res.status(400).json(errorResponse(400, 'Upload the photos again — one of them could not be verified'));
      }
      items.push({ ...item, photoUrls });
    }

    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.workerId !== workerId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }

    if (!isValidTransition(booking.status, 'PENDING_COMPLETION')) {
      return res.status(409).json(errorResponse(409, `Cannot complete booking with status ${booking.status}`));
    }

    if (booking.cancelRequestedAt && !booking.cancelRequestEscalatedAt) {
      return res.status(409).json(errorResponse(409, "Answer the client's cancel request before finishing the job"));
    }

    const storedCompletionPhotoUrl = toOwnedBookingPhotoUrls([completionPhotoUrl], workerId)?.[0] ?? null;
    if (storedCompletionPhotoUrl === null) {
      return res.status(400).json(errorResponse(400, 'Upload the completion photo again — it could not be verified'));
    }

    if (booking.beforePhotoUrls.length === 0) {
      return res.status(409).json(errorResponse(409, 'Post a before photo of the job before marking it done'));
    }
    if (booking.progressPhotoUrls.length === 0) {
      return res.status(409).json(errorResponse(409, 'Post at least one progress photo before marking the job done'));
    }

    const { updated, totalAmount } = await prisma.$transaction(async (tx) => {
      const locked = await lockBooking(tx, id);
      const addOns = locked?.addOns ?? [];

      const stillPendingAddonIds = addOns
        .filter((addon) => addon.clientApprovedAt == null && addon.clientRejectedAt == null)
        .map((addon) => addon.id);
      if (stillPendingAddonIds.length > 0) {
        await tx.bookingAddOn.updateMany({
          where: { id: { in: stillPendingAddonIds } },
          data: { clientRejectedAt: new Date() },
        });
      }

      const sentAt = new Date();
      if (items.length > 0) {
        await tx.bookingAddOn.createMany({
          data: items.map((item) => ({
            bookingId: id,
            kind: item.kind,
            name: item.name,
            price: item.price,
            photoUrls: item.photoUrls,
            clientApprovedAt: sentAt,
          })),
        });
      }

      const billed = [...addOns.filter((addon) => addon.clientApprovedAt != null), ...items];
      const totals = computeBookingFinalTotal({
        estimatedPrice: booking.estimatedPrice,
        laborCost: booking.laborCost,
        materialsCost: booking.materialsCost,
        tip: booking.tip,
        addOns: billed,
        vatApplicable: booking.vatApplicable,
        vatRate: booking.vatRate,
      });

      await updateBookingIfStatus(
        tx,
        id,
        booking.status,
        {
          status: 'PENDING_COMPLETION',
          completionPhotoUrl: storedCompletionPhotoUrl,
          workerCompletedAt: sentAt,
          finalPrice: totals.subtotal,
        },
        { OR: [{ cancelRequestedAt: null }, { cancelRequestEscalatedAt: { not: null } }] }
      );
      const b = await tx.booking.findUniqueOrThrow({ where: { id } });

      // The worker's side of the job is done.
      await tx.workerProfile.update({
        where: { userId: workerId },
        data: { activeJobCount: { decrement: 1 } },
      });

      await tx.bookingVisit.updateMany({
        where: { bookingId: id, status: 'SCHEDULED' },
        data: { status: 'DONE' },
      });

      return { updated: b, totalAmount: totals.totalAmount };
    });

    const method = booking.paymentMethodType ?? 'CASH';
    let status: string = updated.status;
    if (method !== 'CASH') {
      try {
        const invoice = await createCompletionInvoice(id);
        status = 'alreadyPaid' in invoice ? 'COMPLETED' : 'AWAITING_PAYMENT';
      } catch (error) {
        console.error('Raising the payment invoice failed for booking %s; left in PENDING_COMPLETION:', id, error);
      }
    }

    const amount = `₱${totalAmount.toFixed(2)}`;
    await notifyUser({
      userId: booking.clientId,
      type: 'BOOKING_COMPLETED',
      title: 'Your invoice is ready',
      message:
        method === 'CASH'
          ? `Your worker finished the job. Pay ${amount} in cash to your worker. If something on the invoice is wrong, report it in the app before you pay.`
          : `Your worker finished the job. Pay ${amount} with ${method === 'MAYA' ? 'Maya' : 'GCash'} in the app. If something on the invoice is wrong, report it before you pay.`,
      relatedId: id,
    });
    void sendSmsToUser({
      userId: booking.clientId,
      message: `HomeEase: Your worker finished the job (${formatDisplayId(id)}). Amount due: ${amount}. Open the app to see the invoice.`,
    });

    return res.status(200).json({
      success: true,
      message: method === 'CASH' ? 'Invoice sent. Collect the cash, then tap Cash received.' : 'Invoice sent. Waiting for the client to pay.',
      data: {
        id: updated.id,
        status,
        total: totalAmount,
        completionPhotoUrl: updated.completionPhotoUrl,
      },
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error completing booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to complete booking'));
  }
};

export const markCashReceived = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can confirm a cash payment'));
    }

    const id = req.params.id as string;
    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }
    if ((booking.paymentMethodType ?? 'CASH') !== 'CASH') {
      return res.status(409).json(errorResponse(409, 'This client pays with GCash or Maya in the app'));
    }
    if (booking.status !== 'PENDING_COMPLETION') {
      return res.status(409).json(
        errorResponse(
          409,
          booking.status === 'DISPUTED'
            ? 'The client reported this invoice. HomeEase is reviewing it before any payment.'
            : `Cannot confirm a cash payment for a booking with status ${booking.status}`
        )
      );
    }

    const payment = await settleCashBooking(id, ['PENDING_COMPLETION']);

    await notifyUser({
      userId: booking.clientId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment received',
      message: `Your worker confirmed your cash payment of ₱${payment.totalAmount.toFixed(2)}. Thank you for using HomeEase!`,
      relatedId: id,
    });
    void sendSmsToUser({
      userId: booking.clientId,
      message: `HomeEase: Cash payment of ₱${payment.totalAmount.toFixed(2)} received for booking ${formatDisplayId(id)}. Thank you!`,
    });

    return res.status(200).json({
      success: true,
      message: 'Cash payment recorded',
      data: {
        id,
        status: 'COMPLETED',
        payment: {
          status: payment.status,
          methodType: payment.methodType,
          totalAmount: payment.totalAmount,
          workerPayout: payment.workerPayout,
        },
      },
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error recording cash payment:', error);
    return res.status(500).json(errorResponse(500, 'Failed to record the cash payment'));
  }
};

export const reportCashNotPaid = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can report an unpaid cash invoice'));
    }

    const id = req.params.id as string;
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }
    if ((booking.paymentMethodType ?? 'CASH') !== 'CASH') {
      return res.status(409).json(errorResponse(409, 'This client pays with GCash or Maya in the app'));
    }
    if (booking.status !== 'PENDING_COMPLETION') {
      return res.status(409).json(
        errorResponse(
          409,
          booking.status === 'DISPUTED'
            ? 'This invoice is already being reviewed by HomeEase.'
            : `Cannot report an unpaid invoice for a booking with status ${booking.status}`
        )
      );
    }

    const raisedById = req.user.userId;
    const dispute = await prisma.$transaction(async (tx) => {
      await updateBookingIfStatus(tx, id, 'PENDING_COMPLETION', { status: 'DISPUTED' });
      return openOrJoinDisputeTx(
        tx,
        { bookingId: id, raisedById, reason: 'Worker reports the client has not paid the cash invoice' },
        { allowedStatuses: ['DISPUTED'], raisedByRole: 'WORKER' }
      );
    });

    await notifyUser({
      userId: booking.clientId,
      type: 'BOOKING_PROBLEM_REPORTED',
      title: 'Your worker says the cash is unpaid',
      message: `Your worker reported that the cash for booking ${formatDisplayId(id)} has not been paid. HomeEase will review it and contact you.`,
      relatedId: id,
    });

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
    await Promise.all(
      admins.map((admin) =>
        notifyUser({
          userId: admin.id,
          type: 'DISPUTE_OPENED',
          title: 'Cash not paid',
          message: `The worker reports the client has not paid the cash invoice for booking ${formatDisplayId(id)}.`,
          relatedId: dispute.id,
        })
      )
    );

    return res.status(200).json({
      success: true,
      message: 'Reported. HomeEase will review it and contact you.',
      data: { id, status: 'DISPUTED', disputeId: dispute.id },
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error reporting unpaid cash invoice:', error);
    return res.status(500).json(errorResponse(500, 'Failed to report the unpaid invoice'));
  }
};

export const confirmCompletion = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can pay for a booking'));
    }

    const id = req.params.id as string;

    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking does not belong to you'));
    }

    if ((booking.paymentMethodType ?? 'CASH') === 'CASH') {
      return res.status(409).json(errorResponse(409, 'Pay your worker in cash. They confirm it in their app.'));
    }

    if (booking.status !== 'PENDING_COMPLETION' && booking.status !== 'AWAITING_PAYMENT') {
      return res.status(409).json(errorResponse(409, `Cannot pay for a booking with status ${booking.status}`));
    }

    const invoice = await createCompletionInvoice(id);

    if ('alreadyPaid' in invoice) {
      const payment = await prisma.payment.findUnique({ where: { bookingId: id } });
      return res.status(200).json({
        success: true,
        message: 'Payment already received',
        data: {
          id,
          status: 'COMPLETED',
          finalPrice: payment?.subtotal ?? null,
          completedAt: payment?.capturedAt ?? null,
          payment: payment
            ? {
                status: payment.status,
                methodType: payment.methodType,
                totalAmount: payment.totalAmount,
                workerPayout: payment.workerPayout,
              }
            : null,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Payment required',
      data: {
        id,
        status: 'AWAITING_PAYMENT',
        checkoutUrl: invoice.checkoutUrl,
        invoiceId: invoice.invoiceId,
        amount: invoice.amount,
      },
    });
  } catch (error) {
    console.error('Error starting payment:', error);
    return res.status(500).json(errorResponse(500, 'Failed to start the payment'));
  }
};

export const reportInvoice = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can report an invoice'));
    }

    const id = req.params.id as string;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 10 || reason.length > 500) {
      return res.status(400).json(errorResponse(400, 'Tell us what is wrong (10 to 500 characters)'));
    }
    const evidenceUrls: unknown[] = Array.isArray(req.body?.evidenceUrls)
      ? req.body.evidenceUrls.slice(0, 5)
      : [];
    const ownedEvidence = toOwnedBookingPhotoUrls(evidenceUrls, req.user.userId);
    if (!ownedEvidence) {
      return res.status(400).json(errorResponse(400, 'Upload the photos again — one of them could not be verified'));
    }

    const booking = await prisma.booking.findUnique({ where: { id }, include: { payment: { select: { status: true } } } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not yours'));
    }
    if (booking.status !== 'PENDING_COMPLETION' && booking.status !== 'AWAITING_PAYMENT') {
      return res.status(409).json(errorResponse(409, 'You can report the invoice after your worker sends it and before you pay'));
    }
    if (booking.payment?.status === 'COMPLETED') {
      return res.status(409).json(errorResponse(409, 'This invoice is already paid. Contact support for a refund.'));
    }

    const raisedById = req.user.userId;
    const dispute = await prisma.$transaction(async (tx) => {
      await updateBookingIfStatus(tx, id, booking.status, { status: 'DISPUTED', disputeReason: reason });
      return openOrJoinDisputeTx(
        tx,
        { bookingId: id, raisedById, reason: `Invoice reported: ${reason}`, evidenceUrls: ownedEvidence },
        { allowedStatuses: ['DISPUTED'], raisedByRole: 'CLIENT' }
      );
    });

    await voidUnpaidPayment(id, 'Invoice reported by the client').catch((error) => {
      console.error('Failed to void the unpaid invoice for reported booking %s:', id, error);
    });

    if (booking.workerId) {
      await notifyUser({
        userId: booking.workerId,
        type: 'DISPUTE_OPENED',
        title: 'Invoice reported',
        message: `The client reported your invoice: ${reason}. HomeEase will review it. Don't collect payment until then.`,
        relatedId: id,
      });
    }

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
    await Promise.all(
      admins.map((admin) =>
        notifyUser({
          userId: admin.id,
          type: 'DISPUTE_OPENED',
          title: 'Invoice reported',
          message: `The client reported the invoice for booking ${formatDisplayId(id)}: ${reason}`,
          relatedId: dispute.id,
        })
      )
    );

    return res.status(200).json({
      success: true,
      message: 'Reported. HomeEase will review the invoice and contact you.',
      data: { id, status: 'DISPUTED', disputeId: dispute.id },
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error reporting invoice:', error);
    return res.status(500).json(errorResponse(500, 'Failed to report the invoice'));
  }
};

const PROBLEM_REASONS = ['WORKER_NOT_HERE', 'WORKER_STOPPED', 'NEED_TO_CANCEL', 'OTHER'] as const;
type ProblemReason = (typeof PROBLEM_REASONS)[number];
const PROBLEM_LABELS: Record<ProblemReason, string> = {
  WORKER_NOT_HERE: "Worker isn't here",
  WORKER_STOPPED: 'Worker stopped the job',
  NEED_TO_CANCEL: 'Client needs to cancel',
  OTHER: 'Other problem',
};
const WORKER_PING_COOLDOWN_MS = 15 * 60_000;

export const reportBookingProblem = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can report a problem'));
    }
    const id = req.params.id as string;
    const reason = req.body?.reason as ProblemReason;
    if (!PROBLEM_REASONS.includes(reason)) {
      return res.status(400).json(errorResponse(400, `reason must be one of: ${PROBLEM_REASONS.join(', ')}`));
    }
    if (req.body?.note !== undefined && req.body?.note !== null && typeof req.body.note !== 'string') {
      return res.status(400).json(errorResponse(400, 'note must be text'));
    }
    const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : null;
    if (note && note.length > 500) {
      return res.status(400).json(errorResponse(400, 'Keep the note under 500 characters'));
    }
    if (reason === 'OTHER' && (!note || note.length < 10)) {
      return res.status(400).json(errorResponse(400, 'Tell us what is wrong (at least 10 characters)'));
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not yours'));
    }
    if (booking.status !== 'ACCEPTED' && booking.status !== 'IN_PROGRESS') {
      return res.status(409).json(errorResponse(409, 'You can report a problem here until your worker sends the invoice'));
    }
    const workerId = booking.workerId!;

    if (reason === 'WORKER_NOT_HERE' && booking.status === 'ACCEPTED' && !booking.workerArrivedAt) {
      const settings = await getAppSettings();
      const now = new Date();
      const autoCancelAt = new Date(bookingStartInstant(booking).getTime() + settings.noShowGraceMinutes * 60_000);
      if (now >= autoCancelAt) {
        if (!(await cancelAsWorkerNoShow(booking, settings, now))) return bookingConflict(res);
        return res.status(200).json({ success: true, message: 'Booking cancelled', data: { outcome: 'CANCELLED' } });
      }

      const pingedRecently = (at: Date | null) => !!at && now.getTime() - at.getTime() < WORKER_PING_COOLDOWN_MS;
      const tooSoon = () =>
        res.status(429).json(errorResponse(429, 'We already pinged your worker. Give them a few minutes.'));
      if (pingedRecently(booking.workerPingedAt)) return tooSoon();
      try {
        // Guarded so two quick taps send one ping.
        await updateBookingIfStatus(
          prisma,
          id,
          'ACCEPTED',
          { workerPingedAt: now },
          { workerArrivedAt: null, OR: [{ workerPingedAt: null }, { workerPingedAt: { lt: new Date(now.getTime() - WORKER_PING_COOLDOWN_MS) } }] }
        );
      } catch (error) {
        if (!isBookingStatusConflict(error)) throw error;
        const fresh = await prisma.booking.findUnique({ where: { id }, select: { workerPingedAt: true } });
        return pingedRecently(fresh?.workerPingedAt ?? null) ? tooSoon() : bookingConflict(res);
      }
      const message = 'Your client is waiting for you. Head over now or message them.';
      await notifyUser({ userId: workerId, type: 'BOOKING_REMINDER', title: 'Your client is waiting', message, relatedId: id });
      void sendSmsToUser({ userId: workerId, message: `HomeEase ${formatDisplayId(id)}: ${message}` });
      return res.status(200).json({
        success: true,
        message: 'We pinged your worker',
        data: { outcome: 'WORKER_PINGED', autoCancelAt: autoCancelAt.toISOString() },
      });
    }

    if (reason === 'NEED_TO_CANCEL') {
      const alreadyAsked = () =>
        res.status(409).json(errorResponse(409, 'You already asked to cancel. Your worker will answer soon.'));
      if (booking.cancelRequestedAt) return alreadyAsked();
      try {
        await updateBookingIfStatus(
          prisma,
          id,
          booking.status,
          { cancelRequestedAt: new Date(), cancelRequestReason: note },
          { cancelRequestedAt: null }
        );
      } catch (error) {
        if (!isBookingStatusConflict(error)) throw error;
        const fresh = await prisma.booking.findUnique({ where: { id }, select: { status: true, cancelRequestedAt: true } });
        return fresh?.status === booking.status && fresh.cancelRequestedAt ? alreadyAsked() : bookingConflict(res);
      }
      await notifyUser({
        userId: workerId,
        type: 'BOOKING_CANCEL_REQUESTED',
        title: 'Your client wants to cancel',
        message: 'Open the job to agree or decline.',
        relatedId: id,
      });
      return res.status(200).json({ success: true, message: 'We asked your worker', data: { outcome: 'CANCEL_REQUESTED' } });
    }

    const label = PROBLEM_LABELS[reason];
    const dispute = await openBookingDispute({
      bookingId: id,
      raisedById: req.user.userId,
      reason: note ? `${label}: ${note}` : label,
      allowedStatuses: ['ACCEPTED', 'IN_PROGRESS'],
    });
    if (!dispute) {
      return res.status(409).json(errorResponse(409, 'You already reported this. HomeEase is on it.'));
    }
    await notifyUser({
      userId: workerId,
      type: 'BOOKING_PROBLEM_REPORTED',
      title: 'Your client reported a problem',
      message: `${label}. HomeEase will look into it and contact you.`,
      relatedId: id,
    });
    return res.status(200).json({ success: true, message: 'Reported. HomeEase is on it.', data: { outcome: 'REPORTED' } });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error reporting a booking problem:', error);
    return res.status(500).json(errorResponse(500, 'Failed to report the problem'));
  }
};

export const respondToCancelRequest = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const id = req.params.id as string;
    const accept = req.body?.accept;
    if (typeof accept !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'accept must be true or false'));
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    const noRequest = () => res.status(409).json(errorResponse(409, 'There is no cancel request to answer'));
    if (
      booking.workerId !== req.user.userId ||
      (booking.status !== 'ACCEPTED' && booking.status !== 'IN_PROGRESS') ||
      !booking.cancelRequestedAt ||
      booking.cancelRequestEscalatedAt
    ) {
      return noRequest();
    }

    if (!accept) {
      await escalateCancelRequest(booking, 'DECLINED');
      return res.status(200).json({ success: true, message: 'HomeEase will decide', data: { id, status: booking.status } });
    }

    await prisma.$transaction(async (tx) => {
      const fresh = await lockBooking(tx, id);
      if (!fresh || fresh.cancelRequestEscalatedAt) throw new BookingStatusConflictError(id, [booking.status]);
      await finalizeCancellationTx(tx, booking, 'CLIENT', {
        cancelledBy: 'CLIENT',
        cancelledById: booking.clientId,
        reason: 'CLIENT_CANCEL_AGREED',
        penalizedWorkerId: null,
        compensationStatus: 'NOT_APPLICABLE',
      });
    });
    await afterCancellation(id, 'CLIENT_CANCEL_AGREED', booking.clientId);

    await notifyUser({
      userId: booking.clientId,
      type: 'BOOKING_CANCELLED',
      title: 'Booking cancelled',
      message: "Your worker agreed. The booking is cancelled and you won't be charged.",
      relatedId: id,
    });
    return res.status(200).json({ success: true, message: 'Booking cancelled', data: { id, status: 'CANCELLED' } });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error answering a cancel request:', error);
    return res.status(500).json(errorResponse(500, 'Failed to answer the cancel request'));
  }
};

export const cancelBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const id = req.params.id as string;
    const { reason, workerCancellationReason, fault, proofUrls: rawProofUrls } = req.body as {
      reason?: string;
      workerCancellationReason?: string;
      fault?: string;
      proofUrls?: unknown;
    };

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

    const hasPendingReschedule = booking.rescheduledAt != null && booking.rescheduleAcknowledgedAt == null;
    const hasWorkerNoShow = booking.workerNoShowFlaggedAt != null;

    if (req.user.role === 'CLIENT' && booking.status !== 'PENDING' && !hasPendingReschedule && !hasWorkerNoShow) {
      return res.status(409).json(
        errorResponse(
          409,
          'This booking has already been accepted and can no longer be cancelled. Please contact the worker or support if you need help.'
        )
      );
    }

    if (req.user.role === 'WORKER' && ['PENDING_COMPLETION', 'AWAITING_PAYMENT', 'DISPUTED'].includes(booking.status)) {
      return res.status(409).json(errorResponse(409, "The invoice is sent, so this job can't be cancelled here. If something is wrong, contact support."));
    }

    if (!isValidTransition(booking.status, 'CANCELLED')) {
      return res.status(409).json(errorResponse(409, `Cannot cancel booking with status ${booking.status}`));
    }

    const cancelledByRole = req.user.role === 'WORKER' ? 'WORKER' : 'CLIENT';
    const settings = await getAppSettings();

    const afterArrival = cancelledByRole === 'WORKER' && booking.workerArrivedAt != null;
    let cancelFault: 'CLIENT' | 'WORKER' | null = null;
    let proofUrls: string[] = [];

    const noShowCancelAt =
      afterArrival && fault === 'CLIENT' && booking.status === 'ACCEPTED'
        ? await clientNoShowCancelAt(booking, settings.noShowGraceMinutes)
        : null;
    const clientNoShowConfirmed = noShowCancelAt != null && Date.now() >= noShowCancelAt.getTime();
    const cancelReason = clientNoShowConfirmed && !(typeof reason === 'string' && reason.trim().length >= 10) ? 'Client was not home' : reason;

    if (clientNoShowConfirmed) {
      cancelFault = 'CLIENT';
    } else if (afterArrival) {
      if (fault !== 'CLIENT' && fault !== 'WORKER') {
        return res.status(400).json(errorResponse(400, "You've already arrived — say whose fault the cancellation is (CLIENT or WORKER)"));
      }
      if (typeof reason !== 'string' || reason.trim().length < 10) {
        return res.status(400).json(errorResponse(400, 'Explain what happened (at least 10 characters)'));
      }
      const owned = toOwnedBookingPhotoUrls(rawProofUrls ?? [], req.user.userId);
      if (!owned) {
        return res.status(400).json(errorResponse(400, 'Upload the proof photos again — one of them could not be verified'));
      }
      if (owned.length === 0 || owned.length > 5) {
        return res.status(400).json(errorResponse(400, 'Add 1 to 5 photos as proof'));
      }
      cancelFault = fault;
      proofUrls = owned;
    } else if (cancelledByRole === 'WORKER') {
      const VALID_WORKER_CANCEL_REASONS = ['WORKER_FAULT', 'CLIENT_NO_SHOW', 'OTHER'];
      if (!VALID_WORKER_CANCEL_REASONS.includes(workerCancellationReason ?? '')) {
        return res.status(400).json(
          errorResponse(400, `workerCancellationReason must be one of ${VALID_WORKER_CANCEL_REASONS.join(', ')}`)
        );
      }
    }

    const cancelledWithinHours =
      cancelledByRole === 'WORKER'
        ? Math.max(0, Math.round((bookingStartInstant(booking).getTime() - Date.now()) / (60 * 60 * 1000)))
        : null;

    const penaltyAmount = cancelFault === 'WORKER' ? settings.noShowPenaltyAmount : null;
    const compensationAmount =
      cancelFault === 'CLIENT' && settings.clientFaultCompensationAmount > 0 ? settings.clientFaultCompensationAmount : null;
    const compensationStatus =
      cancelFault !== 'CLIENT' || (clientNoShowConfirmed && !compensationAmount)
        ? 'NOT_APPLICABLE'
        : clientNoShowConfirmed
          ? 'APPROVED'
          : 'PENDING_REVIEW';

    const penalizedWorkerId =
      cancelFault === 'WORKER'
        ? req.user.userId
        : cancelledByRole === 'WORKER' &&
            !afterArrival &&
            workerCancellationReason === 'WORKER_FAULT' &&
            cancelledWithinHours != null &&
            cancelledWithinHours < LATE_CANCEL_THRESHOLD_HOURS
          ? req.user.userId
          : hasWorkerNoShow && booking.workerId
            ? booking.workerId
            : null;

    const updated = await prisma.$transaction(async (tx) => {
      const { booking: cancelled, workerProfileId } = await finalizeCancellationTx(
        tx,
        booking,
        cancelledByRole,
        {
          cancelledBy: cancelledByRole,
          cancelledById: req.user!.userId,
          reason: hasPendingReschedule
            ? 'CLIENT_DECLINED_RESCHEDULE'
            : hasWorkerNoShow && cancelledByRole === 'CLIENT'
              ? 'WORKER_NO_SHOW'
              : typeof cancelReason === 'string'
                ? cancelReason.trim()
                : null,
          cancelledWithinHours,
          workerCancellationReason:
            cancelledByRole === 'WORKER'
              ? afterArrival
                ? cancelFault === 'WORKER'
                  ? 'WORKER_FAULT'
                  : 'OTHER'
                : (workerCancellationReason as WorkerCancellationReason)
              : null,
          penalizedWorkerId,
          fault: cancelFault,
          proofUrls,
          penaltyAmount,
          compensationAmount,
          compensationStatus: compensationStatus === 'APPROVED' ? 'PENDING_REVIEW' : compensationStatus,
        },
        cancelReason
      );

      if (clientNoShowConfirmed && booking.workerId && compensationAmount) {
        await applyClientFaultCompensationTx(tx, {
          bookingId: id,
          clientId: booking.clientId,
          workerId: booking.workerId,
          amount: compensationAmount,
          reviewedById: null,
          reviewNote: 'Auto-approved: worker checked in by GPS and waited after alerting the client',
        });
      }

      if (penaltyAmount && workerProfileId) {
        await chargePenaltyTx(tx, workerProfileId, penaltyAmount, {
          bookingId: id,
          note: `Cancelled booking ${formatDisplayId(id)} after arriving (worker's fault)`,
        });
      }

      return cancelled;
    });

    await afterCancellation(id, cancelReason || 'Booking cancelled', req.user.userId);

    const notificationUserId =
      booking.clientId === req.user.userId ? booking.workerId : booking.clientId;

    if (clientNoShowConfirmed && compensationAmount) {
      const displayId = formatDisplayId(id);
      const amount = compensationAmount;
      await notifyUser({
        userId: booking.clientId,
        type: 'CANCELLATION_COMPENSATION',
        title: 'Cancellation fee',
        message: `Your worker waited at the door and couldn't reach you, so booking ${displayId} was cancelled as caused on your side. A ₱${amount.toFixed(2)} fee applies, and new bookings are paused until it's settled. If you were home or want to pay, contact support.`,
        relatedId: id,
      });
      await notifyUser({
        userId: req.user.userId,
        type: 'CANCELLATION_COMPENSATION',
        title: 'Compensation approved',
        message: `Your cancellation of booking ${displayId} was accepted. You'll receive ₱${amount.toFixed(2)} (applied to any dues first, the rest with your next payout).`,
        relatedId: id,
      });
    } else if (clientNoShowConfirmed) {
      // No fee set: a plain cancel for both sides.
      await notifyUser({
        userId: booking.clientId,
        type: 'BOOKING_CANCELLED',
        title: 'Booking Cancelled',
        message: `Your worker waited at the door and couldn't reach you, so booking ${formatDisplayId(id)} was cancelled.`,
        relatedId: id,
      });
      await notifyUser({
        userId: req.user.userId,
        type: 'BOOKING_CANCELLED',
        title: 'Booking Cancelled',
        message: `Booking ${formatDisplayId(id)} was cancelled because the client wasn't home.`,
        relatedId: id,
      });
    } else if (notificationUserId) {
      await notifyUser({
        userId: notificationUserId,
        type: 'BOOKING_CANCELLED',
        title: 'Booking Cancelled',
        message:
          cancelFault === 'CLIENT' && compensationAmount
            ? `Your worker cancelled this job on site and reported it was caused on the client's side: ${reason}. HomeEase will review their proof; a ₱${compensationAmount.toFixed(2)} cancellation fee applies if it's confirmed.`
            : `Booking has been cancelled${reason ? `: ${reason}` : ''}`,
        relatedId: id,
      });
    }

    if (penaltyAmount) {
      await notifyUser({
        userId: req.user.userId,
        type: 'CANCELLATION_PENALTY',
        title: 'Cancellation Penalty',
        message: `A ₱${penaltyAmount.toFixed(2)} penalty was added to your platform dues for cancelling after arriving. It's deducted from your next payouts.`,
        relatedId: id,
      });
    }

    if (cancelFault === 'CLIENT' && !clientNoShowConfirmed) {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
      await Promise.all(
        admins.map((admin) =>
          notifyUser({
            userId: admin.id,
            type: 'CANCELLATION_COMPENSATION',
            title: 'Cancellation Needs Review',
            message: `A worker cancelled booking ${formatDisplayId(id)} on site, blaming the client. Review the proof to decide ${compensationAmount ? 'the compensation' : 'whose fault it was'}.`,
            relatedId: id,
          })
        )
      );
    }

    return res.status(200).json({
      success: true,
      message:
        clientNoShowConfirmed
          ? compensationAmount
            ? 'Booking cancelled — the cancellation fee was approved'
            : 'Booking cancelled successfully'
          : cancelFault === 'CLIENT'
          ? 'Booking cancelled — HomeEase will review your proof'
          : penaltyAmount
            ? `Booking cancelled — a ₱${penaltyAmount.toFixed(2)} penalty applies`
            : 'Booking cancelled successfully',
      data: {
        id: updated.id,
        status: updated.status,
        penaltyAmount,
        compensationStatus,
      },
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) return bookingConflict(res);
    console.error('Error cancelling booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to cancel booking'));
  }
};

export const reportReview = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 5 || reason.length > 500) {
      return res.status(400).json(errorResponse(400, 'Say what is wrong (5 to 500 characters)'));
    }

    const review = await prisma.review.findUnique({
      where: { bookingId: req.params.id as string },
      include: { worker: { select: { userId: true } } },
    });
    const isWorker = review?.worker.userId === req.user.userId;
    const isClient = review?.clientId === req.user.userId;
    if (!review || (!isWorker && !isClient)) {
      return res.status(404).json(errorResponse(404, 'Review not found'));
    }
    if (isClient && !review.workerResponse) {
      return res.status(409).json(errorResponse(409, 'There is no reply to report'));
    }
    const flagTarget = isWorker ? 'REVIEW' : 'RESPONSE';
    const { count } = await prisma.review.updateMany({
      where: {
        id: review.id,
        OR: [{ flagged: false }, { flagTarget }, ...(isWorker ? [{ flagTarget: null }] : [])],
      },
      data: {
        flagged: true,
        flagTarget,
        flagReason: `Reported by the ${isWorker ? 'worker' : 'client'}: ${reason}`,
      },
    });
    if (count === 0) {
      return res.status(409).json(errorResponse(409, 'HomeEase is already checking a report on this review. Try again once it is handled.'));
    }

    return res.json({ success: true, message: 'Thanks. An admin will look at it.' });
  } catch (error) {
    console.error('Error reporting review:', error);
    return res.status(500).json(errorResponse(500, 'Failed to report'));
  }
};

export const submitReview = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can submit reviews'));
    }

    const id = req.params.id as string;
    const { rating, comment, photoUrls } = req.body;

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

    if (!booking.workerId) {
      return res.status(409).json(errorResponse(409, 'Booking has no assigned worker'));
    }

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

    const ratingStats = await prisma.review.aggregate({
      where: { workerId: workerProfile.id, status: 'VISIBLE' },
      _avg: { rating: true },
      _count: true,
    });

    const avgRating = ratingStats._avg.rating ?? 0;

    await prisma.workerProfile.update({
      where: { id: workerProfile.id },
      data: {
        rating: Math.round(avgRating * 10) / 10,
        totalReviews: ratingStats._count,
      },
    });

    await notifyUser({
      userId: booking.workerId,
      type: 'REVIEW_RECEIVED',
      title: 'New Review',
      message: `You received a ${rating}-star review`,
      relatedId: id,
    });

    return res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: {
        id: review.id,
        rating: review.rating,
        comment: maskProfanity(review.comment),
        photoUrls: review.photoUrls,
        workerNewRating: avgRating,
      },
    });
  } catch (error) {
    console.error('Error submitting review:', error);
    return res.status(500).json(errorResponse(500, 'Failed to submit review'));
  }
};