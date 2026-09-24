import { Request, Response } from 'express';
import type { ConditionType, PaymentMethodType, Prisma, RoomType, TimeSlot, WorkerCancellationReason } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { writeAuditLog } from '@utils/auditLog';
import { formatDisplayId } from '@utils/formatters';
import { distanceMeters, isWithinRadiusMeters } from '@utils/geo';
import { resolveDrivingDistanceKm } from '@services/googleDistanceService';
import { resolveTierPrice } from '@services/taskPriceService';
import { findAutoMatchWorker, LATE_CANCEL_THRESHOLD_HOURS } from '@services/matchingService';
import { validatePriceWithinPricingRule } from '@services/pricingRuleService';
import {
  settleCashBooking,
  createCompletionInvoice,
  refundOrVoidPayment,
} from '@services/paymentLifecycleService';
import {
  toDayStart,
  findSlot,
  markSlotBooked,
  freeSlot,
  blockSlotForExtend,
  findNextOpenSlot,
  RESCHEDULE_SEARCH_WINDOW_DAYS,
  isOutsideBookedWindow,
  getSlotStartInstant,
  isSlotAndOverflowFree,
  additionalSlotsForDuration,
} from '@services/workerAvailabilityService';
import {
  calculateWorkerPayout,
  computeBookingFinalTotal,
  computeJobPricing,
  calculateCommission,
  calculateWithholdingTax,
  VAT_RATE,
} from '@utils/pricing';
import { roundToCentavo } from '@utils/money';
import { buildCapabilityFilters } from '@services/matchingService';
import { schedulePendingExpiry, cancelPendingExpiryJob } from '@queues/bookingQueue';
import { VALID_TRANSITIONS, isValidTransition } from '@services/bookingStateMachine';
import { MIN_BOOKING_LEAD_DAYS } from '@middleware/validation';
import { getAppSettings } from '@services/appSettingsService';
import { computeWorkerTier, tierMultiplier } from '@utils/workerTier';
import { VALID_TIME_SLOTS } from '@/constants/bookingEnums';
import { validateScopeAnswers } from '@utils/scopeFields';
import { getIO } from '../socket';
import type { JwtPayload } from '@/types/index';

export { VALID_TRANSITIONS, isValidTransition };

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// Local alias — see backend/src/utils/money.ts for the shared money-rounding helper.
const round2 = roundToCentavo;

const scopeFieldInclude = { options: true, taskLinks: { select: { serviceTaskId: true } } } as const;

async function resolveServiceTypeConfig(name: string) {
  return prisma.serviceType.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    include: { scopeFields: { include: scopeFieldInclude } },
  });
}

async function loadScopeFields(serviceTypeId: string) {
  return prisma.serviceScopeField.findMany({ where: { serviceTypeId }, include: scopeFieldInclude });
}

/**
 * POST /api/bookings
 * Create a new booking (client only).
 *
 * If workerId is omitted, runs the "surprise me" auto-match algorithm
 * (see matchingService.findAutoMatchWorker) to pick a worker instead of
 * requiring the client to choose one. Price is always computed server-side
 * (basePrice + distance/urgency/tier surcharges — see utils/pricing.
 * computeJobPricing), logged via PricingLog, and checked against any
 * PricingRule for (city, serviceType).
 * No Payment row is created here — payment is taken after the job is finished
 * and finally priced (see confirmCompletion). A 1-hour expiry job is queued so
 * an unanswered PENDING booking auto-cancels (see queues/bookingQueue +
 * workers/bookingWorker).
 */
export const createBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can create bookings'));
    }
    const clientId = req.user.userId;

    // Payment hold — mirrors WorkerProfile.debtHoldAt's "blocks new activity
    // until cleared" pattern, applied to the client side of the same
    // problem. Set by adminDisputeController.resolveDispute's
    // RESOLVE_FOR_WORKER action when this client confirmed a job (so the
    // worker's labor is real and done) but the 72h non-payment dispute got
    // resolved without payment ever landing — without this, that client
    // could go straight on to book and strand a second worker the same way.
    const holdingClientProfile = await prisma.clientProfile.findUnique({
      where: { userId: clientId },
      select: { paymentHoldAt: true },
    });
    if (holdingClientProfile?.paymentHoldAt) {
      return res.status(403).json(
        errorResponse(403, 'Your account is on hold for an unpaid booking. Please settle it before booking again.')
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
      timeSlot,
      addOns,
      packageIds,
      priorities,
      tip,
      notes,
      paymentMethodType,
      paymentAccountIdentifier,
      scopeAnswers,
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
      timeSlot: TimeSlot;
      addOns?: Array<{ id?: string; name?: string; price: number }>;
      packageIds?: string[];
      priorities?: string[];
      tip?: number;
      notes?: string;
      paymentMethodType?: PaymentMethodType;
      paymentAccountIdentifier?: string;
      scopeAnswers?: Record<string, string | string[]>;
      issuePhotoUrls?: string[];
      idempotencyKey?: string;
    };

    // Idempotent replay — a retried POST (app backgrounded mid-request,
    // network timeout + user taps Submit again) with the same client-
    // generated key returns the booking already created for it instead of
    // creating a duplicate. Scoped to (clientId, idempotencyKey) — see the
    // @@unique on Booking. Only short-circuits when a key is actually sent;
    // omitting it behaves exactly as before.
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
            timeSlot: existing.timeSlot,
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
    // Urgency was removed as a platform concept (2026-09-14, see
    // utils/pricing.ts) — every new booking is STANDARD. Kept as a named
    // constant (rather than deleted outright) so the PricingLog breakdown
    // JSON below stays self-describing for anyone reading old vs. new rows.
    const effectiveUrgencyLevel = 'STANDARD' as const;

    const scheduledDate = toDayStart(date);
    const clientLocation = { lat, lng };
    const cityName = city ?? '';

    const serviceTask = serviceTaskId
      ? await prisma.serviceTask.findUnique({
          where: { id: serviceTaskId },
          include: { serviceType: true, quantityScopeField: true },
        })
      : null;

    if (serviceTaskId && !serviceTask) {
      return res.status(404).json(errorResponse(404, 'Service task not found'));
    }

    const resolvedServiceTypeName = serviceTask?.serviceType.name ?? serviceType;
    // Category config (for its flat basePrice) is only needed when the client
    // booked straight off a ServiceType rather than a specific ServiceTask.
    const serviceTypeConfig = serviceTask ? null : await resolveServiceTypeConfig(resolvedServiceTypeName);

    if (!serviceTask && !serviceTypeConfig) {
      return res.status(404).json(errorResponse(404, 'Service type not found'));
    }

    // basePrice can't be resolved yet for a serviceTask booking — FIXED/
    // PER_UNIT depend on which worker gets picked (their own WorkerTaskPrice),
    // and CUSTOM_QUOTE has no upfront price at all. Resolved per-candidate
    // inside the worker-resolution loop below (see "basePrice resolution").
    const isCustomQuoteTask = serviceTask?.pricingModel === 'CUSTOM_QUOTE';

    const effectiveScopeAnswers =
      scopeAnswers && typeof scopeAnswers === 'object' && !Array.isArray(scopeAnswers) ? scopeAnswers : undefined;

    // Only the fields that apply to the chosen task are enforced (see
    // utils/scopeFields.fieldAppliesToTask) — a task booking used to skip
    // this check entirely, back when every field was category-wide.
    const scopeFields = serviceTask
      ? await loadScopeFields(serviceTask.serviceTypeId)
      : serviceTypeConfig!.scopeFields;
    const scopeError = validateScopeAnswers(scopeFields, effectiveScopeAnswers ?? {}, serviceTask);
    if (scopeError) {
      return res.status(400).json(errorResponse(400, scopeError));
    }

    // Condition is no longer a platform-wide concept — new bookings don't
    // collect it (an admin who still wants a "condition"-style question can
    // add it as an ordinary scope field). The Booking.condition column is
    // kept only for historical rows.
    const effectiveCondition: ConditionType | null = null;
    const effectiveIssuePhotoUrls = Array.isArray(issuePhotoUrls)
      ? issuePhotoUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
      : [];

    const hasPets = Array.isArray(priorities) && priorities.some((p) => p.toLowerCase().includes('pet'));

    let resolvedWorkerId = requestedWorkerId ?? null;
    let isAutoMatched = false;

    // DeclinedWorker is scoped to one Booking row, so it never protected a
    // client across separate booking ATTEMPTS — decline a match, start a
    // fresh booking request (very plausible right after a "declined" push
    // notification), and the new row's declinedWorkerIds starts empty,
    // letting the same worker who just declined get auto-matched right back
    // immediately. Look up this client's recent declines across ALL their
    // bookings (joining through Booking.clientId, no schema change needed)
    // and exclude them from this brand-new booking's very first match too.
    const RECENT_DECLINE_COOLDOWN_HOURS = 48;
    const recentDeclineCutoff = new Date(Date.now() - RECENT_DECLINE_COOLDOWN_HOURS * 60 * 60 * 1000);
    const recentDeclines = await prisma.declinedWorker.findMany({
      where: { declinedAt: { gte: recentDeclineCutoff }, booking: { clientId } },
      select: { workerId: true },
      distinct: ['workerId'],
    });
    const recentlyDeclinedWorkerIds = recentDeclines.map((d) => d.workerId);

    if (!resolvedWorkerId) {
      const match = await findAutoMatchWorker({
        serviceType: resolvedServiceTypeName,
        serviceTaskId,
        date: scheduledDate,
        timeSlot,
        scopeAnswers: effectiveScopeAnswers,
        hasPets,
        clientLat: lat,
        clientLng: lng,
        excludeWorkerIds: recentlyDeclinedWorkerIds,
      });

      if (!match) {
        return res.status(404).json(errorResponse(404, 'No available worker found for this request'));
      }

      resolvedWorkerId = match.workerId;
      isAutoMatched = true;
    }

    // Bounded so a pathological run of simultaneous auto-match collisions
    // can't loop forever — 2 retries (3 attempts total) covers "two clients
    // landed on the same best worker+slot at once" without turning a single
    // request into an unbounded worker search. Only an auto-matched booking
    // retries; a client who explicitly picked this worker gets the same
    // immediate failure as before — silently substituting a different worker
    // for a choice they made themselves isn't this fix's job.
    const MAX_AUTO_MATCH_RETRIES = 2;
    const triedWorkerIds: string[] = [
      ...recentlyDeclinedWorkerIds,
      ...(isAutoMatched && resolvedWorkerId ? [resolvedWorkerId] : []),
    ];
    const autoMatchParams = {
      serviceType: resolvedServiceTypeName,
      serviceTaskId,
      date: scheduledDate,
      timeSlot,
      scopeAnswers: effectiveScopeAnswers,
      hasPets,
      clientLat: lat,
      clientLng: lng,
    };

    // Fetched once outside the retry loop — a client's own phone doesn't
    // change across auto-match retries within the same request.
    const requestingClient = await prisma.user.findUnique({ where: { id: clientId }, select: { phone: true } });

    for (let attempt = 0; ; attempt++) {
    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: resolvedWorkerId },
      include: {
        user: { select: { phone: true } },
        serviceCategories: { include: { serviceType: { select: { name: true } } } },
      },
    });

    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    // Client booking themselves (or a shared family line) — see the
    // resolved policy on Booking.selfDealingFlag's schema comment:
    // non-blocking, just a signal for admin review. A missing phone on
    // either side never counts as a match.
    const selfDealingFlag = Boolean(
      requestingClient?.phone && workerProfile.user.phone && requestingClient.phone === workerProfile.user.phone
    );

    // Shared by every retryable failure below (slot conflict, unpriced task)
    // so the "exclude this worker, try the next-best auto-match candidate"
    // logic exists in exactly one place instead of being copy-pasted per
    // failure type.
    const tryNextAutoMatchCandidate = async (): Promise<boolean> => {
      if (!isAutoMatched || attempt >= MAX_AUTO_MATCH_RETRIES) return false;
      const nextMatch = await findAutoMatchWorker({ ...autoMatchParams, excludeWorkerIds: triedWorkerIds });
      if (!nextMatch) return false;
      resolvedWorkerId = nextMatch.workerId;
      triedWorkerIds.push(resolvedWorkerId);
      return true;
    };

    // A client picking a specific worker (not auto-match) could otherwise
    // bypass the capability filter Step 3 already applied — re-check
    // server-side so a stale/tampered request can't book a worker who
    // doesn't actually handle what was asked for. Auto-match is already
    // guaranteed correct here (findAutoMatchWorker filters on both at the DB
    // level), so these two checks only matter for an explicitly-picked
    // worker — but without them, a client could bypass search entirely and
    // directly book a worker whose category is still PENDING_VERIFICATION
    // (or who was never connected to it at all), making that gate meaningless.
    if (!isAutoMatched) {
      const capabilityFilters = await buildCapabilityFilters(resolvedServiceTypeName, effectiveScopeAnswers, serviceTask?.id);
      if (capabilityFilters.length > 0) {
        const eligible = await prisma.workerProfile.findFirst({
          where: { userId: resolvedWorkerId, AND: capabilityFilters },
          select: { id: true },
        });
        if (!eligible) {
          return res.status(409).json(errorResponse(409, 'This pro does not handle the selected option for this service'));
        }
      }

      const bookedCategory = workerProfile.serviceCategories.find(
        (c) => c.serviceType.name.toLowerCase() === resolvedServiceTypeName.toLowerCase()
      );
      if (!bookedCategory || bookedCategory.status !== 'VERIFIED') {
        return res.status(409).json(errorResponse(409, 'This pro does not offer this service'));
      }
    }

    if (workerProfile.kycStatus !== 'APPROVED') {
      return res.status(403).json(errorResponse(403, 'Worker is not verified yet'));
    }

    if (!workerProfile.isAvailable) {
      return res.status(409).json(errorResponse(409, 'Worker is not currently available'));
    }

    if (workerProfile.debtHoldAt) {
      return res.status(409).json(errorResponse(409, 'Worker is not currently available'));
    }

    if (workerProfile.activeJobCount >= workerProfile.maxConcurrentJobs) {
      return res.status(409).json(errorResponse(409, 'Worker is at maximum capacity'));
    }

    // A job whose estimated duration exceeds one 4h TimeSlot bucket also
    // needs whichever same-day slot(s) it spills into to be free — checking
    // only the requested slot let a genuinely double-booking-length job
    // through the front door in the first place (see
    // additionalSlotsForDuration's schema-adjacent comment).
    const slotAndOverflowFree = await isSlotAndOverflowFree(
      prisma,
      workerProfile.id,
      scheduledDate,
      timeSlot,
      serviceTask?.durationHours
    );
    if (!slotAndOverflowFree) {
      if (await tryNextAutoMatchCandidate()) continue;
      return res.status(409).json(errorResponse(409, 'Selected slot is no longer available'));
    }

    // basePrice depends on which worker got picked — FIXED/PER_UNIT read
    // that worker's own WorkerTaskPrice (findAutoMatchWorker already filters
    // auto-match candidates down to workers who've priced this task, but an
    // explicitly-picked worker isn't filtered, hence the 409 fallback below).
    // CUSTOM_QUOTE has no upfront price; the client is never shown one until
    // the worker submits a quote, so basePrice is 0 and the VAT snapshot
    // below is deliberately deferred to that moment instead of now.
    let basePrice: number;
    if (serviceTask) {
      if (isCustomQuoteTask) {
        // No WorkerTaskPrice exists for a CUSTOM_QUOTE task (priced on-site),
        // so eligibility is checked against WorkerTaskSelection instead —
        // findAutoMatchWorker already filters auto-match candidates down to
        // workers who've selected this task, but an explicitly-picked worker
        // isn't filtered, hence the fallback here (same pattern as the
        // FIXED/PER_UNIT price check just below).
        const selection = await prisma.workerTaskSelection.findUnique({
          where: {
            workerProfileId_serviceTaskId: { workerProfileId: workerProfile.id, serviceTaskId: serviceTask.id },
          },
        });
        if (!selection?.isActive) {
          if (await tryNextAutoMatchCandidate()) continue;
          return res.status(409).json(errorResponse(409, 'This pro does not offer this specific service'));
        }
        basePrice = 0;
      } else if (serviceTask.pricingModel === 'TIERED') {
        // No WorkerTaskPrice row for TIERED — a worker's price table lives
        // in WorkerTaskTierPrice (many rows per worker+task, one per price
        // step they defined themselves — see that model's docblock).
        const field = serviceTask.quantityScopeField;
        const quantity = field ? Number(effectiveScopeAnswers?.[field.label]) : NaN;
        if (!field || Number.isNaN(quantity)) {
          return res
            .status(400)
            .json(errorResponse(400, `"${field?.label ?? 'quantity'}" is required for this service`));
        }
        const tierRows = await prisma.workerTaskTierPrice.findMany({
          where: { workerProfileId: workerProfile.id, serviceTaskId: serviceTask.id, isActive: true },
        });
        const resolvedPrice = resolveTierPrice(tierRows, quantity);
        if (resolvedPrice == null) {
          // Either the worker hasn't priced this task at all, or their price
          // steps simply don't cover this quantity — both are the worker
          // not being a valid candidate for this specific job, not an error
          // to recover from (see WorkerTaskTierPrice's docblock).
          if (await tryNextAutoMatchCandidate()) continue;
          return res.status(409).json(errorResponse(409, 'This pro has not priced this service for this quantity'));
        }
        basePrice = resolvedPrice;
      } else {
        const workerPrice = await prisma.workerTaskPrice.findUnique({
          where: {
            workerProfileId_serviceTaskId: { workerProfileId: workerProfile.id, serviceTaskId: serviceTask.id },
          },
        });
        if (!workerPrice?.isActive) {
          if (await tryNextAutoMatchCandidate()) continue;
          return res.status(409).json(errorResponse(409, 'This pro has not priced this service yet'));
        }
        if (serviceTask.pricingModel === 'FIXED') {
          basePrice = workerPrice.price!;
        } else {
          const field = serviceTask.quantityScopeField;
          const quantity = field ? Number(effectiveScopeAnswers?.[field.label]) : NaN;
          if (!field || Number.isNaN(quantity)) {
            return res
              .status(400)
              .json(errorResponse(400, `"${field?.label ?? 'quantity'}" is required for this service`));
          }
          basePrice = round2(workerPrice.unitPrice! * quantity);
        }
      }
    } else {
      basePrice = serviceTypeConfig!.basePrice;
    }

    // VAT snapshot — pinned from the worker's status at the earliest point a
    // real price is shown, so settlement never re-checks the worker's live
    // vatRegistered flag (see paymentLifecycleService.priceBooking).
    const vatApplicable = !isCustomQuoteTask && workerProfile.vatRegistered;
    const vatRate = vatApplicable ? VAT_RATE : null;

    // Distance fee is based on the worker's fixed service address, not a
    // live position — bookings are scheduled in advance, not dispatched to
    // wherever the worker happens to be right now, so this is a static
    // "shipping fee" style distance rather than real-time proximity (see
    // WorkerProfile.addressLat/addressLng comment). Real driving-route
    // distance (Google Distance Matrix) when configured, falling back to
    // straight-line distance otherwise — see googleDistanceService.
    const workerDistanceKm =
      workerProfile.addressLat != null && workerProfile.addressLng != null
        ? await resolveDrivingDistanceKm(clientLocation, { lat: workerProfile.addressLat, lng: workerProfile.addressLng })
        : null;

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
    const { distanceFee, urgencyFee, tierFee, estimatedPrice } = computeJobPricing({
      basePrice,
      tierMultiplier: tierMultiplier(workerTier, appSettings),
      distanceKm: workerDistanceKm,
      freeDistanceKm: appSettings.freeDistanceKm,
      perKmFee: appSettings.perKmFee,
    });
    // Kept in the response/log shape below for compatibility with existing
    // clients/receipts — always 0 now that condition carries no platform fee.
    const conditionFee = 0;
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
      const { booking } = await prisma.$transaction(async (tx) => {
        // Re-check KYC + capacity + slot inside the transaction to close the
        // race between the checks above and this insert (e.g. an admin
        // rejecting the worker in that window).
        const workerTx = await tx.workerProfile.findUnique({ where: { userId: resolvedWorkerId! } });
        if (!workerTx) throw new Error('WORKER_NOT_FOUND');
        if (workerTx.kycStatus !== 'APPROVED') throw new Error('WORKER_NOT_APPROVED');
        if (workerTx.activeJobCount >= workerTx.maxConcurrentJobs) throw new Error('AT_CAPACITY');

        const slotAndOverflowFreeTx = await isSlotAndOverflowFree(
          tx,
          workerTx.id,
          scheduledDate,
          timeSlot,
          serviceTask?.durationHours
        );
        if (!slotAndOverflowFreeTx) throw new Error('SLOT_TAKEN');

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

        await markSlotBooked(tx, workerTx.id, scheduledDate, timeSlot, serviceTask?.durationHours);

        // No Payment row is created here — the client pays after the job is
        // finished and finally priced (see confirmCompletion). Nothing is held.
        return { booking: created };
      });

      // Best-effort — the booking is already committed at this point, so a
      // Redis hiccup here must not turn a real success into an apparent
      // failure to the client (it would just retry into the idempotency
      // path above and get told "already created" for a booking it thinks
      // never happened). Worst case if this silently fails: the booking
      // never gets its 1-hour PENDING auto-expiry, which is a smaller,
      // recoverable gap than a false "booking failed" error.
      await schedulePendingExpiry(booking.id).catch((error) => {
        console.error(`Failed to schedule pending-expiry for booking ${booking.id}:`, error);
      });

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
          workerTier,
          estimatedPrice: booking.estimatedPrice,
          estimatedDurationHours: booking.estimatedDurationHours,
          expiresAt: booking.expiresAt,
          pricing: {
            basePrice,
            conditionFee,
            distanceFee,
            urgencyFee,
            tierFee,
            addOnsTotal,
            finalEstimate,
            addOns: addOnsList,
          },
          // Payment is collected after completion — none exists yet.
          payment: null,
        },
      });
    } catch (txErr: any) {
      const isIdempotencyConflict =
        txErr.code === 'P2002' &&
        hasIdempotencyKey &&
        Array.isArray(txErr.meta?.target) &&
        txErr.meta.target.includes('idempotencyKey');
      const isSlotConflict = txErr.message === 'SLOT_TAKEN' || (txErr.code === 'P2002' && !isIdempotencyConflict);

      // Same retry as the pre-transaction slot check above — a second client
      // can win the race between our findSlot check and this insert
      // (worker_live_slot_unique surfaces it as SLOT_TAKEN or a P2002 on
      // that index). For an auto-matched booking that's not something the client
      // did wrong, so retry with the next-best candidate instead of making
      // them resubmit manually.
      if (isSlotConflict && (await tryNextAutoMatchCandidate())) continue;

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
        // Two near-simultaneous requests carrying the same idempotencyKey
        // both passed the upfront lookup above before either committed —
        // genuine race, not a slot conflict. Whichever loses this race
        // should see the same "already created" reply as a normal replay,
        // not a misleading slot error.
        if (isIdempotencyConflict) {
          return res.status(409).json(
            errorResponse(409, 'This booking request is already being processed — check your bookings list.')
          );
        }
        return res.status(409).json(errorResponse(409, 'Slot no longer available'));
      }
      throw txErr;
    }
    }
  } catch (error) {
    console.error('Error creating booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to create booking'));
  }
};

/**
 * POST /api/bookings/multi-day
 * Books the SAME worker for N consecutive calendar days upfront (e.g. a
 * 3-day deep-clean job) — see the "multi-day upfront booking" backlog item.
 *
 * Deliberately NOT a Booking.scheduledDate date-range: every downstream
 * system (pricing, chat threads, arrival/completion verification, payment/
 * payout, worker matching) assumes one Booking row = one calendar day, and
 * reworking that would ripple through all of it. Instead this creates a
 * lightweight BookingGroup that links N ordinary single-day Booking rows —
 * each day accepts/declines, checks in, completes, and gets paid completely
 * independently, exactly like any other single-day booking; BookingGroup
 * exists purely so "My Bookings" can show "Day 2 of 3" instead of three
 * unrelated-looking jobs.
 *
 * A much narrower version of createBooking above, by design:
 * - workerId is REQUIRED — no auto-match. A multi-day job needs one worker
 *   committed across every day, which only makes sense once the client has
 *   already picked that specific worker (the worker-profile "Book Now"
 *   entry point, mirrored by mobile's `draft.workerLocked`).
 * - CUSTOM_QUOTE service tasks aren't supported — there's no price to sum
 *   across days until a worker inspects the job and quotes it, which is
 *   inherently a single-job flow, not an upfront multi-day one.
 * - No packages/addOns/tip for this first version — those interact with
 *   per-day pricing in ways (charged once? per day?) that have no obvious
 *   right answer yet, so they're left for a follow-up rather than guessed at.
 *
 * All-or-nothing: every one of the N consecutive days is checked for
 * availability before anything is written, and re-checked again inside the
 * transaction that creates the group — if ANY day conflicts, the whole
 * request fails and zero rows are created (mirrors createBooking's own
 * race-closing re-check, just looped over N days instead of one).
 */
export const createMultiDayBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can create bookings'));
    }
    const clientId = req.user.userId;

    const holdingClientProfile = await prisma.clientProfile.findUnique({
      where: { userId: clientId },
      select: { paymentHoldAt: true },
    });
    if (holdingClientProfile?.paymentHoldAt) {
      return res.status(403).json(
        errorResponse(403, 'Your account is on hold for an unpaid booking. Please settle it before booking again.')
      );
    }

    const {
      workerId,
      serviceType,
      serviceTaskId,
      description,
      address,
      city,
      lat,
      lng,
      startDate,
      dayCount,
      timeSlot,
      priorities,
      notes,
      paymentMethodType,
      paymentAccountIdentifier,
      scopeAnswers,
      issuePhotoUrls,
      idempotencyKey,
    } = req.body as {
      workerId: string;
      serviceType: string;
      serviceTaskId?: string;
      description?: string;
      address: string;
      city?: string;
      lat: number;
      lng: number;
      startDate: string;
      dayCount: number;
      timeSlot: TimeSlot;
      priorities?: string[];
      notes?: string;
      paymentMethodType?: PaymentMethodType;
      paymentAccountIdentifier?: string;
      scopeAnswers?: Record<string, string | string[]>;
      issuePhotoUrls?: string[];
      idempotencyKey?: string;
    };

    // Idempotent replay — same rationale as createBooking's, but keyed off
    // BookingGroup (see its schema comment for why it can't share Booking's
    // own idempotencyKey column: every one of the N rows in a group would
    // otherwise collide on the same (clientId, idempotencyKey) pair).
    const hasIdempotencyKey = typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0;
    if (hasIdempotencyKey) {
      const existingGroup = await prisma.bookingGroup.findUnique({
        where: { client_group_idempotency_key_unique: { clientId, idempotencyKey: idempotencyKey! } },
        include: { bookings: { orderBy: { scheduledDate: 'asc' } } },
      });
      if (existingGroup) {
        return res.status(200).json({
          success: true,
          message: 'Booking already created for this request',
          data: formatMultiDayBookingResponse(existingGroup),
        });
      }
    }

    const cityName = city ?? '';
    const clientLocation = { lat, lng };
    const startDay = toDayStart(startDate);
    const scheduledDays: Date[] = Array.from({ length: dayCount }, (_, i) => {
      const d = new Date(startDay);
      d.setUTCDate(d.getUTCDate() + i);
      return d;
    });

    const serviceTask = serviceTaskId
      ? await prisma.serviceTask.findUnique({
          where: { id: serviceTaskId },
          include: { serviceType: true, quantityScopeField: true },
        })
      : null;

    if (serviceTaskId && !serviceTask) {
      return res.status(404).json(errorResponse(404, 'Service task not found'));
    }

    if (serviceTask?.pricingModel === 'CUSTOM_QUOTE') {
      return res.status(400).json(
        errorResponse(400, "Multi-day bookings aren't available for custom-quote services yet — book one day at a time instead.")
      );
    }

    const resolvedServiceTypeName = serviceTask?.serviceType.name ?? serviceType;
    const serviceTypeConfig = serviceTask ? null : await resolveServiceTypeConfig(resolvedServiceTypeName);

    if (!serviceTask && !serviceTypeConfig) {
      return res.status(404).json(errorResponse(404, 'Service type not found'));
    }

    const effectiveScopeAnswers =
      scopeAnswers && typeof scopeAnswers === 'object' && !Array.isArray(scopeAnswers) ? scopeAnswers : undefined;

    // Only the fields that apply to the chosen task are enforced (see
    // utils/scopeFields.fieldAppliesToTask) — a task booking used to skip
    // this check entirely, back when every field was category-wide.
    const scopeFields = serviceTask
      ? await loadScopeFields(serviceTask.serviceTypeId)
      : serviceTypeConfig!.scopeFields;
    const scopeError = validateScopeAnswers(scopeFields, effectiveScopeAnswers ?? {}, serviceTask);
    if (scopeError) {
      return res.status(400).json(errorResponse(400, scopeError));
    }

    const effectiveIssuePhotoUrls = Array.isArray(issuePhotoUrls)
      ? issuePhotoUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
      : [];

    const requestingClient = await prisma.user.findUnique({ where: { id: clientId }, select: { phone: true } });

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      include: {
        user: { select: { phone: true } },
        serviceCategories: { include: { serviceType: { select: { name: true } } } },
      },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const selfDealingFlag = Boolean(
      requestingClient?.phone && workerProfile.user.phone && requestingClient.phone === workerProfile.user.phone
    );

    // Same capability/category re-check as createBooking's explicit-worker
    // path (there is no auto-match path here to have already guaranteed it).
    const capabilityFilters = await buildCapabilityFilters(resolvedServiceTypeName, effectiveScopeAnswers, serviceTask?.id);
    if (capabilityFilters.length > 0) {
      const eligible = await prisma.workerProfile.findFirst({
        where: { userId: workerId, AND: capabilityFilters },
        select: { id: true },
      });
      if (!eligible) {
        return res.status(409).json(errorResponse(409, 'This pro does not handle the selected option for this service'));
      }
    }
    const bookedCategory = workerProfile.serviceCategories.find(
      (c) => c.serviceType.name.toLowerCase() === resolvedServiceTypeName.toLowerCase()
    );
    if (!bookedCategory || bookedCategory.status !== 'VERIFIED') {
      return res.status(409).json(errorResponse(409, 'This pro does not offer this service'));
    }
    if (workerProfile.kycStatus !== 'APPROVED') {
      return res.status(403).json(errorResponse(403, 'Worker is not verified yet'));
    }
    if (!workerProfile.isAvailable) {
      return res.status(409).json(errorResponse(409, 'Worker is not currently available'));
    }
    if (workerProfile.debtHoldAt) {
      return res.status(409).json(errorResponse(409, 'Worker is not currently available'));
    }
    if (workerProfile.activeJobCount >= workerProfile.maxConcurrentJobs) {
      return res.status(409).json(errorResponse(409, 'Worker is at maximum capacity'));
    }

    // Every day must be free before anything is written — a client-facing
    // pre-check so a day-5-of-7 conflict is reported clearly instead of a
    // generic transaction failure, mirrored again (race-closing) inside the
    // transaction below.
    for (const day of scheduledDays) {
      const free = await isSlotAndOverflowFree(prisma, workerProfile.id, day, timeSlot, serviceTask?.durationHours);
      if (!free) {
        return res.status(409).json(
          errorResponse(409, `${workerProfile.user ? 'This pro' : 'The selected worker'} isn't available on ${day.toISOString().slice(0, 10)} — try a different start date or day count.`)
        );
      }
    }

    // basePrice/distance/tier are identical for every day (same worker, same
    // task, same address) — computed once and reused N times, rather than
    // re-derived per day.
    let basePrice: number;
    if (serviceTask) {
      if (serviceTask.pricingModel === 'TIERED') {
        const field = serviceTask.quantityScopeField;
        const quantity = field ? Number(effectiveScopeAnswers?.[field.label]) : NaN;
        if (!field || Number.isNaN(quantity)) {
          return res.status(400).json(errorResponse(400, `"${field?.label ?? 'quantity'}" is required for this service`));
        }
        const tierRows = await prisma.workerTaskTierPrice.findMany({
          where: { workerProfileId: workerProfile.id, serviceTaskId: serviceTask.id, isActive: true },
        });
        const resolvedPrice = resolveTierPrice(tierRows, quantity);
        if (resolvedPrice == null) {
          return res.status(409).json(errorResponse(409, 'This pro has not priced this service for this quantity'));
        }
        basePrice = resolvedPrice;
      } else {
        const workerPrice = await prisma.workerTaskPrice.findUnique({
          where: { workerProfileId_serviceTaskId: { workerProfileId: workerProfile.id, serviceTaskId: serviceTask.id } },
        });
        if (!workerPrice?.isActive) {
          return res.status(409).json(errorResponse(409, 'This pro has not priced this service yet'));
        }
        if (serviceTask.pricingModel === 'FIXED') {
          basePrice = workerPrice.price!;
        } else {
          const field = serviceTask.quantityScopeField;
          const quantity = field ? Number(effectiveScopeAnswers?.[field.label]) : NaN;
          if (!field || Number.isNaN(quantity)) {
            return res.status(400).json(errorResponse(400, `"${field?.label ?? 'quantity'}" is required for this service`));
          }
          basePrice = round2(workerPrice.unitPrice! * quantity);
        }
      }
    } else {
      basePrice = serviceTypeConfig!.basePrice;
    }

    const vatApplicable = workerProfile.vatRegistered;
    const vatRate = vatApplicable ? VAT_RATE : null;

    const workerDistanceKm =
      workerProfile.addressLat != null && workerProfile.addressLng != null
        ? await resolveDrivingDistanceKm(clientLocation, { lat: workerProfile.addressLat, lng: workerProfile.addressLng })
        : null;

    const appSettings = await getAppSettings();
    const workerCompletedJobs = await prisma.booking.count({ where: { workerId, status: 'COMPLETED' } });
    const workerTier = computeWorkerTier(workerProfile.rating, workerCompletedJobs, appSettings);

    const { distanceFee, urgencyFee, tierFee, estimatedPrice } = computeJobPricing({
      basePrice,
      tierMultiplier: tierMultiplier(workerTier, appSettings),
      distanceKm: workerDistanceKm,
      freeDistanceKm: appSettings.freeDistanceKm,
      perKmFee: appSettings.perKmFee,
    });
    const finalEstimate = round2(estimatedPrice);

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
      const group = await prisma.$transaction(async (tx) => {
        const workerTx = await tx.workerProfile.findUnique({ where: { userId: workerId } });
        if (!workerTx) throw new Error('WORKER_NOT_FOUND');
        if (workerTx.kycStatus !== 'APPROVED') throw new Error('WORKER_NOT_APPROVED');
        if (workerTx.activeJobCount >= workerTx.maxConcurrentJobs) throw new Error('AT_CAPACITY');

        for (const day of scheduledDays) {
          const freeTx = await isSlotAndOverflowFree(tx, workerTx.id, day, timeSlot, serviceTask?.durationHours);
          if (!freeTx) throw new Error(`SLOT_TAKEN:${day.toISOString().slice(0, 10)}`);
        }

        const createdGroup = await tx.bookingGroup.create({
          data: {
            clientId,
            workerId,
            totalDays: dayCount,
            idempotencyKey: hasIdempotencyKey ? (idempotencyKey as string) : null,
          },
        });

        for (const day of scheduledDays) {
          const createdBooking = await tx.booking.create({
            data: {
              clientId,
              workerId,
              groupId: createdGroup.id,
              serviceType: resolvedServiceTypeName,
              serviceTaskId: serviceTaskId ?? null,
              description: description ?? '',
              estimatedDurationHours: serviceTask?.durationHours ?? null,
              priorities: Array.isArray(priorities) ? priorities : [],
              scopeAnswers: effectiveScopeAnswers,
              issuePhotoUrls: effectiveIssuePhotoUrls,
              scheduledDate: day,
              timeSlot,
              isAutoMatched: false,
              selfDealingFlag,
              declinedWorkerIds: [],
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
              estimatedPrice: finalEstimate,
              vatApplicable,
              vatRate,
              tip: 0,
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
          });

          await tx.pricingLog.create({
            data: {
              bookingId: createdBooking.id,
              basePrice,
              conditionFee: 0,
              distanceFee,
              urgencyFee,
              tierFee,
              addOnsTotal: 0,
              finalEstimate,
              breakdown: {
                basePrice,
                conditionFee: 0,
                distanceFee,
                urgencyFee,
                tierFee,
                addOnsTotal: 0,
                finalEstimate,
                workerTier,
                distanceKm: workerDistanceKm,
                isAutoMatched: false,
                groupId: createdGroup.id,
              },
            },
          });

          await markSlotBooked(tx, workerTx.id, day, timeSlot, serviceTask?.durationHours);
        }

        return tx.bookingGroup.findUniqueOrThrow({
          where: { id: createdGroup.id },
          include: { bookings: { orderBy: { scheduledDate: 'asc' } } },
        });
      });

      // Best-effort, same reasoning as createBooking's — a Redis hiccup here
      // must not turn an already-committed group into an apparent failure.
      await Promise.all(
        group.bookings.map((b) =>
          schedulePendingExpiry(b.id).catch((error) => {
            console.error(`Failed to schedule pending-expiry for booking ${b.id}:`, error);
          })
        )
      );

      await notifyUser({
        userId: workerId,
        type: 'BOOKING_REQUEST',
        title: 'New Multi-Day Booking Request',
        message: `A client has requested your service for ${dayCount} consecutive days starting ${scheduledDays[0].toISOString().slice(0, 10)}`,
        relatedId: group.bookings[0]?.id,
      });

      return res.status(201).json({
        success: true,
        message: 'Multi-day booking created successfully',
        data: formatMultiDayBookingResponse(group),
      });
    } catch (txErr: any) {
      if (typeof txErr.message === 'string' && txErr.message.startsWith('SLOT_TAKEN:')) {
        const conflictDate = txErr.message.split(':')[1];
        return res.status(409).json(errorResponse(409, `Slot no longer available on ${conflictDate}`));
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
        if (hasIdempotencyKey && Array.isArray(txErr.meta?.target) && txErr.meta.target.includes('idempotencyKey')) {
          return res.status(409).json(
            errorResponse(409, 'This booking request is already being processed — check your bookings list.')
          );
        }
        return res.status(409).json(errorResponse(409, 'Slot no longer available'));
      }
      throw txErr;
    }
  } catch (error) {
    console.error('Error creating multi-day booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to create multi-day booking'));
  }
};

function formatMultiDayBookingResponse(
  group: Prisma.BookingGroupGetPayload<{ include: { bookings: true } }>
) {
  return {
    groupId: group.id,
    totalDays: group.totalDays,
    bookings: group.bookings.map((b) => ({
      id: b.id,
      scheduledDate: b.scheduledDate,
      timeSlot: b.timeSlot,
      status: b.status,
      estimatedPrice: b.estimatedPrice,
      expiresAt: b.expiresAt,
    })),
    totalEstimatedPrice: round2(group.bookings.reduce((sum, b) => sum + b.estimatedPrice, 0)),
  };
}

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
          // Multi-day upfront booking (see createMultiDayBooking) — lets the
          // list show "Day 2 of 3" instead of three unrelated-looking jobs.
          // Ordered by date (not insertion order) so dayIndex below always
          // reflects calendar position even if rows were created out of order.
          group: { include: { bookings: { select: { id: true }, orderBy: { scheduledDate: 'asc' } } } },
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
      // Broken out separately (not just folded into workerPayoutEstimate) so
      // the request list can call out "includes a ₱X tip" as a deliberate
      // acceptance incentive rather than burying it in one blended number.
      tip: b.tip ?? 0,
      // Estimate only — the authoritative payout is on the Payment row,
      // settled at capture time (see paymentLifecycleService).
      workerPayoutEstimate: calculateWorkerPayout(b.finalPrice ?? b.estimatedPrice, b.tip ?? 0, commissionRate, withholdingTaxRate),
      rating: b.review?.rating ?? null,
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
            workerProfile: { select: { kycStatus: true, currentLat: true, currentLng: true, lastLocationUpdate: true } },
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
        // Multi-day upfront booking (see createMultiDayBooking) — lets the
        // detail screen show "Day 2 of 3" and offer a "Cancel entire job"
        // convenience action over the sibling bookings.
        group: { include: { bookings: { orderBy: { scheduledDate: 'asc' } } } },
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

    // addOns use `price` field (not `cost`) per schema. Only approved
    // add-ons count toward the displayed total — the full list (including
    // any still-pending ones) is still returned below (`addOns:
    // booking.addOns`) so the client/worker UI can show and act on them.
    const addonsCost = (booking.addOns || [])
      .filter((addon: any) => addon.clientApprovedAt != null)
      .reduce((sum: number, addon: any) => sum + addon.price, 0);
    const hasQuote = booking.laborCost != null && booking.materialsCost != null;
    const finalPrice = hasQuote
      ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0) + addonsCost
      : booking.estimatedPrice + addonsCost;

    // Client-facing itemized breakdown — assembled from data already fetched
    // above rather than a fresh query. basePrice/distanceFee/tierFee come
    // from the most recent PricingLog row (append-only, one per pricing
    // computation); vatAmount prefers the settled Payment row (Booking.vatAmount
    // is only filled in at settlement, see schema) over the pre-settlement 0.
    const latestPricingLog = booking.pricingLogs[booking.pricingLogs.length - 1] ?? null;
    const breakdownTip = booking.payment?.tip ?? booking.tip ?? 0;
    const priceBreakdown = {
      basePrice: latestPricingLog?.basePrice ?? null,
      distanceFee: latestPricingLog?.distanceFee ?? 0,
      tierFee: latestPricingLog?.tierFee ?? 0,
      addOns: (booking.addOns || [])
        .filter((addon: any) => addon.clientApprovedAt != null)
        .map((addon: any) => ({ name: addon.name, price: addon.price })),
      subtotal: finalPrice,
      vatApplicable: booking.vatApplicable,
      vatRate: booking.vatRate,
      vatAmount: booking.payment?.vatAmount ?? booking.vatAmount ?? 0,
      tip: breakdownTip,
      total: booking.payment?.totalAmount ?? round2(finalPrice + breakdownTip),
    };

    return res.status(200).json({
      success: true,
      message: 'Booking details retrieved successfully',
      data: {
        id: booking.id,
        // Multi-day upfront booking (see createMultiDayBooking) — null for
        // the overwhelming majority of ordinary single-day bookings. Sibling
        // list is date-ordered so the client can compute "Day X of N" and
        // offer a "Cancel entire job" action over the other bookingIds.
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
              // Last known live position while en route (see
              // updateWorkerLiveLocation) — only meaningful for an ACCEPTED
              // booking; gives the client's tracking map a starting marker
              // before the first live socket push arrives.
              currentLat: booking.worker.workerProfile?.currentLat ?? null,
              currentLng: booking.worker.workerProfile?.currentLng ?? null,
              lastLocationUpdate: booking.worker.workerProfile?.lastLocationUpdate ?? null,
            }
          : null,
        service: booking.serviceTask?.name ?? booking.serviceType,
        category: booking.serviceTask?.serviceType?.name ?? booking.serviceType,
        status: booking.status,
        description: booking.description,
        location: booking.location,
        city: booking.city,
        // Booking address coordinates — client-side re-offer flow (a declined
        // booking's "Find Another Pro") needs these to prefill a new draft
        // without asking the client to re-pick their address.
        clientLat: booking.clientLat,
        clientLng: booking.clientLng,
        scheduledDate: booking.scheduledDate,
        scheduledTime: booking.scheduledTime,
        timeSlot: booking.timeSlot,
        urgencyLevel: booking.urgencyLevel,
        // Reschedule-on-conflict (see extendBooking) — rescheduleAcknowledgedAt
        // null means this is still an open episode awaiting the client's
        // explicit keep-the-date response (or the 24h auto-confirm sweep).
        rescheduledAt: booking.rescheduledAt,
        previousScheduledDate: booking.previousScheduledDate,
        previousTimeSlot: booking.previousTimeSlot,
        // The true original date/slot, surviving multiple reschedule hops —
        // see Booking.originalScheduledDate's schema comment.
        originalScheduledDate: booking.originalScheduledDate,
        originalTimeSlot: booking.originalTimeSlot,
        rescheduleAcknowledgedAt: booking.rescheduleAcknowledgedAt,
        // Reschedule-on-REQUEST (see requestReschedule) — rescheduleRequestRespondedAt
        // null means still awaiting the worker's accept/decline.
        rescheduleRequestedAt: booking.rescheduleRequestedAt,
        requestedScheduledDate: booking.requestedScheduledDate,
        requestedTimeSlot: booking.requestedTimeSlot,
        rescheduleRequestRespondedAt: booking.rescheduleRequestRespondedAt,
        rescheduleRequestAccepted: booking.rescheduleRequestAccepted,
        // Set by bookingWorker.flagWorkerNoShows — non-null means the
        // client can cancel penalty-free even though the booking is past
        // PENDING (see cancelBooking's hasWorkerNoShow carve-out).
        workerNoShowFlaggedAt: booking.workerNoShowFlaggedAt,
        rooms: booking.rooms,
        condition: booking.condition,
        scopeAnswers: booking.scopeAnswers,
        priorities: booking.priorities,
        isAutoMatched: booking.isAutoMatched,
        estimatedPrice: booking.estimatedPrice,
        finalPrice,
        // VAT snapshot — see Booking.vatApplicable/vatRate schema comment.
        // vatAmount itself lives inside priceBreakdown below (settlement-time).
        vatApplicable: booking.vatApplicable,
        vatRate: booking.vatRate,
        priceBreakdown,
        // Raw tip the client committed at booking time — exposed at top level
        // (not just inside `payment`) so the worker can see it before a
        // Payment row exists (pre-completion: Pending/Accepted/InProgress).
        tip: booking.tip,
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
          // Real column, stamped once in acceptBooking — not derived from
          // updatedAt, which moves on every later write (quote, add-on,
          // photo) and would misreport "accepted" as whenever the row was
          // last touched. Null for bookings accepted before this column
          // existed (display-only field, no backfill).
          acceptedAt: booking.acceptedAt,
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

        // Outstanding-dues gate — blocks acceptance while the worker's
        // account is on hold (see debtLedgerService.ts). Already-accepted
        // bookings are never affected by this.
        if (workerProfile.debtHoldAt) {
          throw new Error('ACCOUNT_ON_HOLD');
        }

        // Pin the platform's current commission/withholding-tax rate onto
        // the booking now — mirrors how vatApplicable/vatRate are already
        // pinned early — so a later admin rate change can't retroactively
        // alter what this worker agreed to for this job (see schema comment).
        const { commissionRate, withholdingTaxRate, workerDebtHoldLimit } = await getAppSettings();

        // CASH debt accrual is reactive (see debtLedgerService.accrueDebtTx)
        // — a worker only finds out they've crossed the hold limit after
        // completing the job that tips them over it. This is a heads-up,
        // not a gate: the job may still be worth doing even if it risks a
        // hold, so it's surfaced as a warning in the response, never
        // blocking acceptance.
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

        // Update booking status
        const updated = await tx.booking.update({
          where: { id },
          data: {
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            commissionRateSnapshot: commissionRate,
            withholdingTaxRateSnapshot: withholdingTaxRate,
          },
        });

        // Increment activeJobCount
        await tx.workerProfile.update({
          where: { userId: currentUserId },
          data: { activeJobCount: { increment: 1 } },
        });

        if (booking.timeSlot) {
          await markSlotBooked(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot, booking.estimatedDurationHours);
        }

        return { booking: updated, debtWarning };
      });

      // The booking is no longer PENDING, so the 1-hour auto-expiry no
      // longer applies. Best-effort: the accept already committed above, so
      // a Redis hiccup here must not turn that real success into a false
      // "failed to accept" for the worker — worst case a stale expiry job
      // fires later and no-ops (expirePendingBooking re-checks status is
      // still PENDING before doing anything).
      await cancelPendingExpiryJob(id).catch((error) => {
        console.error(`Failed to cancel pending-expiry job for accepted booking ${id}:`, error);
      });

      // Create notification for client
      await notifyUser({
        userId: result.booking.clientId,
        type: 'BOOKING_ACCEPTED',
        title: 'Booking Accepted',
        message: 'Your booking has been accepted',
        relatedId: result.booking.id,
      });

      // A worker accepting is the "is my booking actually happening" moment —
      // SMS it in addition to the in-app/push notification above so it
      // reaches the client even with the app closed and no push token
      // registered. Fire-and-forget: never block the response on it, and a
      // failed/skipped send (no phone on file, PhilSMS error) is swallowed
      // inside sendSmsToUser.
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
      if (txError.message === 'Worker is at maximum capacity') {
        return res.status(409).json(errorResponse(409, txError.message));
      }
      if (txError.message === 'ACCOUNT_ON_HOLD') {
        // 402 (not 403) — the mobile app's axios interceptor force-logs-out
        // on any 401/403, which would be wrong here (this isn't an auth
        // problem). 402 is a deliberately distinct status so the mobile app
        // can surface the account-hold messaging instead of a generic toast.
        return res.status(402).json(
          errorResponse(
            402,
            'Your account is on hold due to outstanding platform dues. Please contact support to continue accepting jobs.'
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
        await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot, booking.estimatedDurationHours);
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

    // Best-effort — the decline already committed above (see the
    // createBooking/acceptBooking equivalents for why this must not fail
    // the request).
    await cancelPendingExpiryJob(id).catch((error) => {
      console.error(`Failed to cancel pending-expiry job for declined booking ${id}:`, error);
    });
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
          scopeAnswers: updated.scopeAnswers as Record<string, string | string[]> | null,
          excludeWorkerIds: updatedDeclinedWorkerIds,
          clientLat: updated.clientLat,
          clientLng: updated.clientLng,
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

// Basic sanity bound on a worker's self-reported GPS accuracy radius at
// check-in — see the comment inside arriveBooking for why 100m.
const MAX_ARRIVAL_ACCURACY_METERS = 100;

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
    const { lat, lng, accuracy, mocked } = req.body as {
      lat: number;
      lng: number;
      accuracy?: number | null;
      mocked?: boolean | null;
    };

    // Android-only (`Location.isFromMockProvider()`), reported by the client
    // in `mobile/services/location.ts`. Unlike accuracy drift, a device
    // deliberately running a mock-location provider is never accidental, so
    // this hard-blocks rather than just flagging — same as it isn't real
    // device attestation: a rooted device or a patched client can still lie
    // about this field entirely. It raises the bar; it doesn't close it.
    if (mocked === true) {
      return res.status(409).json(
        errorResponse(409, 'Mock location detected — disable any mock-location app or GPS spoofing tool to check in')
      );
    }

    // Basic sanity bound on reported GPS accuracy — NOT real device
    // attestation (a spoofed client can still lie about this field, or omit
    // it entirely, same as it can lie about lat/lng). This only raises the
    // bar by rejecting check-ins whose own self-reported accuracy radius is
    // already too coarse to trust against the geofence, mirroring the
    // precedent set by UserAddress.geocodeAccuracy (also an optional,
    // self-reported GPS accuracy figure in meters). 100m matches
    // AppSettings.geofenceRadiusMeters' own default — a fix that imprecise
    // can't meaningfully confirm presence within a geofence of that size.
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

    const arrivedAt = new Date();
    // Flag-only, per C9 — never blocks the check-in itself, just surfaces a
    // suspicious early/late/wrong-day arrival for admin dispute review.
    // timeSlot is nullable only for legacy rows predating the column; skip
    // the check rather than flag when it's unknown.
    const outsideWindow = booking.timeSlot ? isOutsideBookedWindow(booking.scheduledDate, booking.timeSlot, arrivedAt) : false;

    const [arrival, updated] = await prisma.$transaction([
      prisma.arrivalVerification.create({
        data: {
          bookingId: id,
          workerLat: lat,
          workerLng: lng,
          distanceMeters: distance,
          isVerified: true,
          isOutsideBookedWindow: outsideWindow,
          // Always false here — a true value already hard-blocked above
          // before any row could be created; the column just records that
          // explicitly rather than relying on its schema default.
          mockedLocation: false,
        },
      }),
      prisma.booking.update({
        where: { id },
        data: { workerArrivedAt: arrivedAt, workerLat: lat, workerLng: lng },
      }),
    ]);

    await notifyUser({
      userId: updated.clientId,
      type: 'BOOKING_ACCEPTED',
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
        metadata: { bookingId: id, scheduledDate: booking.scheduledDate.toISOString(), timeSlot: booking.timeSlot, arrivedAt: arrivedAt.toISOString() },
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

/**
 * PATCH /api/bookings/:id/live-location
 * Worker's foreground GPS watch pings this while en route to an ACCEPTED
 * booking. Stores the latest position on WorkerProfile.currentLat/currentLng
 * (nothing per-booking to keep this a cheap, high-frequency write) and pushes
 * it straight to the client's already-open socket connection so the "Track
 * Service" map can move the worker's marker live. Stops mattering once the
 * worker checks in (see arriveBooking) — the mobile app stops sending at
 * that point, and the client screen falls back to the static arrival pin.
 */
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

    // Only meaningful while the worker is travelling to the job — once
    // arrived/started there's nothing left to "track" on a map.
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
 * PATCH /api/bookings/:id/extend
 * Worker signals a job is running into a second day. Reserves tomorrow's
 * calendar for the spillover, and — for any other booking of theirs that
 * collides with it — reschedules it to the worker's next open day (same
 * TimeSlot), or escalates to an admin-visible dispute if none is found
 * within RESCHEDULE_SEARCH_WINDOW_DAYS. Deliberately a side-channel field
 * change, not a new BookingStatus (mirrors arriveBooking writing
 * workerArrivedAt without transitioning status) — this booking's own status
 * is untouched by this endpoint.
 *
 * Narrow and worker/system-triggered by design — NOT the general client-
 * facing "reschedule whenever" feature removed 2026-08-17, and not the
 * client-initiated reschedule-request either (a client never calls this).
 */
export const extendBooking = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can extend a job'));
    }

    const id = req.params.id as string;
    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }
    if (booking.status !== 'IN_PROGRESS') {
      return res.status(409).json(errorResponse(409, `Cannot extend a booking with status ${booking.status}`));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, availableDays: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    // Anchored to whichever is later: tomorrow relative to right now, or the
    // day after this booking's ORIGINALLY scheduled date. Plain "tomorrow
    // relative to now" breaks if the job spills past midnight before the
    // worker taps this — at 1am on what's now day 2, "tomorrow" would
    // resolve to day 3, skipping the day actually being worked. A repeat
    // call (spillover into a third day) still correctly advances past
    // whichever day was already reserved, since scheduledDate never moves
    // on the ORIGINAL booking — only the anchor's "now" component changes.
    const now = new Date();
    const tomorrowFromNow = toDayStart(now);
    tomorrowFromNow.setUTCDate(tomorrowFromNow.getUTCDate() + 1);
    const dayAfterScheduled = toDayStart(booking.scheduledDate);
    dayAfterScheduled.setUTCDate(dayAfterScheduled.getUTCDate() + 1);
    const targetDate = tomorrowFromNow.getTime() > dayAfterScheduled.getTime() ? tomorrowFromNow : dayAfterScheduled;

    const { moved, escalated, steamrolledRequests } = await prisma.$transaction(async (tx) => {
      const moved: { bookingId: string; clientId: string; newDate: Date }[] = [];
      const escalated: { bookingId: string; clientId: string }[] = [];
      const steamrolledRequests: { bookingId: string; clientId: string }[] = [];

      for (const timeSlot of VALID_TIME_SLOTS) {
        const collision = await tx.booking.findFirst({
          where: {
            workerId: req.user!.userId,
            scheduledDate: targetDate,
            timeSlot,
            status: { in: ['PENDING', 'ACCEPTED'] },
          },
        });

        if (collision) {
          let handled = false;
          let searchFrom = targetDate;

          for (let attempt = 0; attempt < RESCHEDULE_SEARCH_WINDOW_DAYS; attempt++) {
            const nextOpenDate = await findNextOpenSlot(tx, workerProfile.id, workerProfile.availableDays, searchFrom, timeSlot);
            if (!nextOpenDate) break;

            try {
              // Keyed by the collision's expected pre-move fields — a second,
              // overlapping /extend call racing the same collision matches 0
              // rows here and silently no-ops instead of double-moving it.
              const moveResult = await tx.booking.updateMany({
                where: {
                  id: collision.id,
                  scheduledDate: collision.scheduledDate,
                  timeSlot: collision.timeSlot,
                  status: { in: ['PENDING', 'ACCEPTED'] },
                },
                data: {
                  scheduledDate: nextOpenDate,
                  rescheduledAt: new Date(),
                  previousScheduledDate: collision.scheduledDate,
                  previousTimeSlot: collision.timeSlot,
                  // Written once, only if this is the first hop — see
                  // Booking.originalScheduledDate's schema comment. `collision`
                  // reflects the pre-move state fetched moments ago in this
                  // same transaction, and the where clause above is keyed to
                  // that exact state, so this stays consistent with the
                  // existing race-safety guarantee (a losing concurrent call
                  // matches 0 rows here regardless).
                  ...(collision.originalScheduledDate == null
                    ? { originalScheduledDate: collision.scheduledDate, originalTimeSlot: collision.timeSlot }
                    : {}),
                  rescheduledFromBookingId: booking.id,
                  rescheduleAcknowledgedAt: null,
                  rescheduleReminderSentAt: null,
                },
              });

              if (moveResult.count === 1) {
                // Non-null — the collision was found by filtering on this
                // exact timeSlot above, Booking.timeSlot is just nullable in
                // the schema for rows that predate it being required.
                await freeSlot(tx, workerProfile.id, collision.scheduledDate, collision.timeSlot!);
                await markSlotBooked(tx, workerProfile.id, nextOpenDate, timeSlot);
                moved.push({ bookingId: collision.id, clientId: collision.clientId, newDate: nextOpenDate });
              }
              // count === 0: an overlapping call already moved this exact
              // collision — treat as handled either way, nothing left to do.
              handled = true;
              break;
            } catch {
              // worker_live_slot_unique hit — this candidate day was claimed
              // by a real, still-live booking between the search and the
              // move. Advance one more day within the same bound and try
              // again.
              searchFrom = nextOpenDate;
            }
          }

          if (!handled) {
            escalated.push({ bookingId: collision.id, clientId: collision.clientId });
          }
        }

        // A different booking's pending client-initiated reschedule REQUEST
        // (see requestReschedule) targeting this exact slot is about to be
        // silently invalidated by the block below — blockSlotForExtend
        // always overwrites blockedByBookingId unconditionally, with no
        // awareness of what it's displacing. Resolve it as declined now
        // (mirrors respondToRescheduleRequest's own decline shape) and
        // notify that client immediately instead of letting them find out
        // later via a generic 409 when the worker tries to accept it.
        const pendingRequestCollision = await tx.booking.findFirst({
          where: {
            workerId: req.user!.userId,
            requestedScheduledDate: targetDate,
            requestedTimeSlot: timeSlot,
            rescheduleRequestedAt: { not: null },
            rescheduleRequestRespondedAt: null,
          },
          select: { id: true, clientId: true },
        });
        if (pendingRequestCollision) {
          await tx.booking.update({
            where: { id: pendingRequestCollision.id },
            data: { rescheduleRequestRespondedAt: new Date(), rescheduleRequestAccepted: false },
          });
          steamrolledRequests.push({ bookingId: pendingRequestCollision.id, clientId: pendingRequestCollision.clientId });
        }

        // Reserve targetDate for THIS booking's own spillover regardless of
        // whether a collision existed there, moved, or got escalated — the
        // worker still needs the day either way.
        await blockSlotForExtend(tx, workerProfile.id, targetDate, timeSlot, booking.id);
      }

      return { moved, escalated, steamrolledRequests };
    });

    await Promise.all(
      moved.map((m) =>
        notifyUser({
          userId: m.clientId,
          type: 'BOOKING_RESCHEDULED',
          title: 'Your Booking Was Moved',
          message: `Your pro needs another day for a previous job — we moved your booking to ${m.newDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}. Keep the new date or cancel free of charge.`,
          relatedId: m.bookingId,
        })
      )
    );

    for (const e of escalated) {
      const existingDispute = await prisma.dispute.findFirst({
        where: { bookingId: e.bookingId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      });
      if (existingDispute) continue;

      const dispute = await prisma.dispute.create({
        data: {
          bookingId: e.bookingId,
          raisedById: req.user.userId,
          reason: 'A worker needed another day for a previous job and no open slot was found within 14 days to move this booking to.',
          status: 'OPEN',
        },
      });

      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
      await Promise.all(
        admins.map((admin) =>
          notifyUser({
            userId: admin.id,
            type: 'BOOKING_RESCHEDULE_ESCALATED',
            title: 'Reschedule Needs Attention',
            message: `Booking ${formatDisplayId(e.bookingId)} couldn't be rescheduled automatically — no open slot found for its worker within 14 days.`,
            relatedId: dispute.id,
          })
        )
      );

      await notifyUser({
        userId: e.clientId,
        type: 'BOOKING_RESCHEDULE_ESCALATED',
        title: 'Your Booking Needs Rescheduling',
        message: 'Your pro needs another day for a previous job and we could not find a new slot automatically — support will reach out to reschedule this with you.',
        relatedId: e.bookingId,
      });
    }

    await Promise.all(
      steamrolledRequests.map((r) =>
        notifyUser({
          userId: r.clientId,
          type: 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
          title: 'Reschedule Declined',
          message: 'The date/time you requested is no longer available — your pro needed it for another job. Your booking stays as originally scheduled; feel free to request a different date.',
          relatedId: r.bookingId,
        })
      )
    );

    await writeAuditLog({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: 'BOOKING_EXTENDED',
      category: 'STATUS_CHANGE',
      message: `Booking ${formatDisplayId(id)} extended into ${targetDate.toISOString().slice(0, 10)} — ${moved.length} booking(s) rescheduled, ${escalated.length} escalated, ${steamrolledRequests.length} pending reschedule request(s) invalidated`,
      metadata: {
        bookingId: id,
        targetDate: targetDate.toISOString(),
        moved: moved.length,
        escalated: escalated.length,
        steamrolledRequests: steamrolledRequests.length,
      },
    });

    return res.status(200).json({
      success: true,
      message:
        escalated.length > 0
          ? `Reserved tomorrow. ${moved.length} booking(s) rescheduled; ${escalated.length} escalated to support.`
          : `Reserved tomorrow.${moved.length > 0 ? ` ${moved.length} booking(s) rescheduled automatically.` : ''}`,
      data: { targetDate, resolved: moved.length, escalated: escalated.length },
    });
  } catch (error) {
    console.error('Error extending booking:', error);
    return res.status(500).json(errorResponse(500, 'Failed to extend booking'));
  }
};

/**
 * PATCH /api/bookings/:id/acknowledge-reschedule
 * Client explicitly keeps the new date for a booking a worker's spillover
 * moved (see extendBooking) — status-preserving, just resolves the
 * reschedule episode. The client's other option is the existing cancel
 * flow, which cancelBooking's hasPendingReschedule carve-out lets through
 * fee-free while this is still unresolved.
 */
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

/**
 * PATCH /api/bookings/:id/request-reschedule
 * Client-initiated reschedule-on-REQUEST — distinct from extendBooking's
 * reschedule-on-CONFLICT above (that one is worker/system-triggered and
 * moves a DIFFERENT booking; this is the client of THIS booking asking for
 * a different date, which the assigned worker must explicitly accept).
 * Deliberately narrow: one proposed date/slot, one worker response — NOT a
 * return of the general free-form reschedule feature removed 2026-08-17.
 * Only available on an ACCEPTED booking (worker hasn't started yet).
 */
export const requestReschedule = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only the client can request a reschedule'));
    }

    const id = req.params.id as string;
    const { date, timeSlot } = req.body as { date?: string; timeSlot?: TimeSlot };

    if (!date || isNaN(new Date(date).getTime())) {
      return res.status(400).json(errorResponse(400, 'date is required and must be a valid date'));
    }
    if (!timeSlot || !VALID_TIME_SLOTS.includes(timeSlot)) {
      return res.status(400).json(errorResponse(400, `timeSlot is required and must be one of ${VALID_TIME_SLOTS.join(', ')}`));
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking does not belong to you'));
    }
    if (booking.status !== 'ACCEPTED') {
      return res.status(409).json(errorResponse(409, `Cannot request a reschedule for a booking with status ${booking.status}`));
    }
    if (!booking.workerId) {
      return res.status(409).json(errorResponse(409, 'This booking has no assigned worker'));
    }
    if (booking.rescheduleRequestedAt != null && booking.rescheduleRequestRespondedAt == null) {
      return res.status(409).json(errorResponse(409, 'You already have a pending reschedule request for this booking'));
    }

    const requestedDate = toDayStart(date);

    // Same minimum-lead-time rule a new booking is held to — the worker
    // still needs advance notice, a reschedule request shouldn't be a
    // backdoor around it.
    const minLeadMs = MIN_BOOKING_LEAD_DAYS * 24 * 60 * 60 * 1000;
    const todayUtc = toDayStart(new Date());
    if (requestedDate.getTime() - todayUtc.getTime() < minLeadMs) {
      return res.status(400).json(errorResponse(400, `date must be at least ${MIN_BOOKING_LEAD_DAYS} days from today`));
    }
    if (requestedDate.getTime() === toDayStart(booking.scheduledDate).getTime() && timeSlot === booking.timeSlot) {
      return res.status(400).json(errorResponse(400, 'That is already this booking\'s current date and time'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: booking.workerId },
      select: { id: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    await prisma.$transaction(async (tx) => {
      const slot = await findSlot(tx, workerProfile.id, requestedDate, timeSlot);
      if (slot && (slot.isBlocked || slot.isBooked)) {
        throw new Error('SLOT_TAKEN');
      }

      await blockSlotForExtend(tx, workerProfile.id, requestedDate, timeSlot, booking.id);

      await tx.booking.update({
        where: { id },
        data: {
          requestedScheduledDate: requestedDate,
          requestedTimeSlot: timeSlot,
          rescheduleRequestedAt: new Date(),
          rescheduleRequestReminderSentAt: null,
          rescheduleRequestRespondedAt: null,
          rescheduleRequestAccepted: null,
        },
      });
    });

    await notifyUser({
      userId: booking.workerId,
      type: 'BOOKING_RESCHEDULE_REQUESTED',
      title: 'Reschedule Requested',
      message: `Your client asked to move this booking to ${requestedDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}. Review and accept or decline.`,
      relatedId: id,
    });

    await writeAuditLog({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: 'BOOKING_RESCHEDULE_REQUESTED',
      category: 'STATUS_CHANGE',
      message: `Client requested a reschedule for booking ${formatDisplayId(id)} to ${requestedDate.toISOString().slice(0, 10)} ${timeSlot}`,
      metadata: { bookingId: id, requestedDate: requestedDate.toISOString(), timeSlot },
    });

    return res.status(200).json({
      success: true,
      message: 'Reschedule requested — waiting for your pro to respond',
      data: { id, requestedScheduledDate: requestedDate, requestedTimeSlot: timeSlot },
    });
  } catch (error: any) {
    if (error.message === 'SLOT_TAKEN') {
      return res.status(409).json(errorResponse(409, 'Your pro is not available at that date/time'));
    }
    console.error('Error requesting reschedule:', error);
    return res.status(500).json(errorResponse(500, 'Failed to request reschedule'));
  }
};

/**
 * PATCH /api/bookings/:id/reschedule-request/withdraw
 * Client backs out of their own still-pending reschedule request. Recorded
 * as a resolved episode with rescheduleRequestAccepted left null — distinct
 * from an explicit accept (true) or decline (false) by the worker.
 */
export const withdrawRescheduleRequest = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only the client can withdraw a reschedule request'));
    }

    const id = req.params.id as string;
    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking does not belong to you'));
    }
    if (booking.rescheduleRequestedAt == null || booking.rescheduleRequestRespondedAt != null) {
      return res.status(409).json(errorResponse(409, 'There is no pending reschedule request to withdraw'));
    }

    await prisma.$transaction(async (tx) => {
      if (booking.workerId && booking.requestedScheduledDate && booking.requestedTimeSlot) {
        const workerProfile = await tx.workerProfile.findUnique({
          where: { userId: booking.workerId },
          select: { id: true },
        });
        if (workerProfile) {
          await tx.workerAvailability.updateMany({
            where: {
              workerProfileId: workerProfile.id,
              date: booking.requestedScheduledDate,
              timeSlot: booking.requestedTimeSlot,
              blockedByBookingId: booking.id,
              isBooked: false,
            },
            data: { isBlocked: false, blockedByBookingId: null },
          });
        }
      }

      await tx.booking.update({
        where: { id },
        data: { rescheduleRequestRespondedAt: new Date(), rescheduleRequestAccepted: null },
      });
    });

    return res.status(200).json({ success: true, message: 'Reschedule request withdrawn', data: { id } });
  } catch (error) {
    console.error('Error withdrawing reschedule request:', error);
    return res.status(500).json(errorResponse(500, 'Failed to withdraw reschedule request'));
  }
};

/**
 * PATCH /api/bookings/:id/reschedule-request/respond
 * Worker accepts or declines the client's proposed new date/time. Accepting
 * moves the booking for real (frees the old slot, books the new one);
 * declining just releases the held slot and leaves the booking as-is.
 */
export const respondToRescheduleRequest = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only the assigned worker can respond to a reschedule request'));
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
    if (booking.workerId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not assigned to you'));
    }
    if (booking.rescheduleRequestedAt == null || booking.rescheduleRequestRespondedAt != null) {
      return res.status(409).json(errorResponse(409, 'There is no pending reschedule request to respond to'));
    }
    if (!booking.requestedScheduledDate || !booking.requestedTimeSlot) {
      return res.status(409).json(errorResponse(409, 'This reschedule request is missing its requested date/time'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    await prisma.$transaction(async (tx) => {
      if (accept) {
        // Re-check the requested slot is still genuinely open — the block
        // from requestReschedule should have held it, but this guards
        // against anything that slipped past it (e.g. an admin adjustment).
        // No row at all is fine (nothing occupies it, same convention
        // findSlot's other callers use) — only a REAL booking there, or a
        // block belonging to someone else, is a genuine conflict.
        const slot = await findSlot(tx, workerProfile.id, booking.requestedScheduledDate!, booking.requestedTimeSlot!);
        if (slot && (slot.isBooked || (slot.isBlocked && slot.blockedByBookingId !== booking.id))) {
          throw new Error('SLOT_NO_LONGER_AVAILABLE');
        }
        // For a multi-hour job, also guard its overflow slot(s) — unlike the
        // primary slot, requestReschedule never pre-holds these, so any
        // occupant at all (booked or blocked, no "belongs to this booking"
        // exception) is a genuine conflict.
        for (const extraSlot of additionalSlotsForDuration(booking.requestedTimeSlot!, booking.estimatedDurationHours)) {
          const extra = await findSlot(tx, workerProfile.id, booking.requestedScheduledDate!, extraSlot);
          if (extra && (extra.isBooked || extra.isBlocked)) {
            throw new Error('SLOT_NO_LONGER_AVAILABLE');
          }
        }

        if (booking.timeSlot) {
          await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot, booking.estimatedDurationHours);
        }
        await markSlotBooked(tx, workerProfile.id, booking.requestedScheduledDate!, booking.requestedTimeSlot!, booking.estimatedDurationHours);
        // markSlotBooked only sets isBooked — explicitly clear the block
        // fields too, since this slot is a real booking now, not a hold.
        await tx.workerAvailability.updateMany({
          where: { workerProfileId: workerProfile.id, date: booking.requestedScheduledDate!, timeSlot: booking.requestedTimeSlot! },
          data: { isBlocked: false, blockedByBookingId: null },
        });

        await tx.booking.update({
          where: { id },
          data: {
            scheduledDate: booking.requestedScheduledDate!,
            timeSlot: booking.requestedTimeSlot!,
            rescheduleRequestRespondedAt: new Date(),
            rescheduleRequestAccepted: true,
          },
        });
      } else {
        await tx.workerAvailability.updateMany({
          where: {
            workerProfileId: workerProfile.id,
            date: booking.requestedScheduledDate!,
            timeSlot: booking.requestedTimeSlot!,
            blockedByBookingId: booking.id,
            isBooked: false,
          },
          data: { isBlocked: false, blockedByBookingId: null },
        });

        await tx.booking.update({
          where: { id },
          data: { rescheduleRequestRespondedAt: new Date(), rescheduleRequestAccepted: false },
        });
      }
    });

    await notifyUser({
      userId: booking.clientId,
      type: accept ? 'BOOKING_RESCHEDULE_REQUEST_ACCEPTED' : 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
      title: accept ? 'Reschedule Accepted' : 'Reschedule Declined',
      message: accept
        ? 'Your pro accepted the new date for your booking.'
        : 'Your pro could not accommodate the new date — your booking stays as originally scheduled.',
      relatedId: id,
    });

    await writeAuditLog({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: accept ? 'BOOKING_RESCHEDULE_REQUEST_ACCEPTED' : 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
      category: 'STATUS_CHANGE',
      message: `Worker ${accept ? 'accepted' : 'declined'} the reschedule request for booking ${formatDisplayId(id)}`,
      metadata: { bookingId: id },
    });

    return res.status(200).json({
      success: true,
      message: accept ? 'Reschedule accepted' : 'Reschedule declined',
      data: { id },
    });
  } catch (error: any) {
    if (error.message === 'SLOT_NO_LONGER_AVAILABLE') {
      return res.status(409).json(errorResponse(409, 'That slot is no longer available'));
    }
    console.error('Error responding to reschedule request:', error);
    return res.status(500).json(errorResponse(500, 'Failed to respond to reschedule request'));
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
    const { notes } = req.body;

    // Unlike laborCost (validated below for CUSTOM_QUOTE tasks, pinned to
    // estimatedPrice otherwise), materialsCost was taken straight from the
    // request with no check at all — a worker could submit a negative value
    // (reducing the client's total below what labor alone costs) or a
    // non-numeric value that would silently corrupt the stored quote.
    const rawMaterialsCost = req.body.materialsCost;
    const materialsCost = rawMaterialsCost === undefined || rawMaterialsCost === null ? 0 : Number(rawMaterialsCost);
    if (!Number.isFinite(materialsCost) || materialsCost < 0) {
      return res.status(400).json(errorResponse(400, 'materialsCost must be a non-negative number'));
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { serviceTask: { select: { pricingModel: true } } },
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

    // CUSTOM_QUOTE tasks have no upfront price (estimatedPrice is 0 from
    // createBooking) — the worker's laborCost here IS the first real price
    // the client sees, so it's accepted from the request instead of pinned,
    // and the VAT snapshot (deliberately deferred at creation — see
    // createBooking) happens now instead, from the worker's status at this
    // exact moment. Every other task keeps today's behavior unchanged:
    // laborCost pinned to the already-agreed estimatedPrice, VAT already
    // snapshotted at creation, never touched again.
    const isCustomQuoteTask = booking.serviceTask?.pricingModel === 'CUSTOM_QUOTE';
    let laborCost = booking.estimatedPrice;
    let vatUpdate: { vatApplicable: boolean; vatRate: number | null } | undefined;

    if (isCustomQuoteTask) {
      const requestedLaborCost = Number(req.body.laborCost);
      if (!Number.isFinite(requestedLaborCost) || requestedLaborCost <= 0) {
        return res.status(400).json(errorResponse(400, 'laborCost is required for a custom-quote service'));
      }
      laborCost = requestedLaborCost;

      const workerProfile = booking.workerId
        ? await prisma.workerProfile.findUnique({
            where: { userId: booking.workerId },
            select: { vatRegistered: true },
          })
        : null;
      const vatApplicable = !!workerProfile?.vatRegistered;
      vatUpdate = { vatApplicable, vatRate: vatApplicable ? VAT_RATE : null };
    }

    // Quote fields live directly on Booking — no separate Quote model in schema.
    const updated = await prisma.booking.update({
      where: { id },
      data: {
        laborCost,
        materialsCost,
        quoteNotes: notes,
        quoteStatus: 'SUBMITTED',
        quotedAt: new Date(),
        status: 'QUOTE_SUBMITTED',
        ...vatUpdate,
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
      // Only approved add-ons count toward the locked finalPrice — see
      // BookingAddOn.clientApprovedAt's schema comment.
      include: { addOns: { where: { clientApprovedAt: { not: null } } } },
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

    // DISPUTED -> QUOTE_APPROVED is a valid transition, but only for an
    // admin resolving the dispute (adminDisputeController APPROVE_QUOTE).
    // Letting the client approve it here moved the booking on while its
    // Dispute row stayed OPEN, leaving an orphan in the admin queue whose
    // quote actions all 409 with "Booking is not currently disputed".
    if (booking.status === 'DISPUTED') {
      return res.status(409).json(errorResponse(409, 'This quote is under admin review and can no longer be approved directly'));
    }

    if (!isValidTransition(booking.status, 'QUOTE_APPROVED')) {
      return res.status(409).json(errorResponse(409, `Cannot approve quote for booking with status ${booking.status}`));
    }

    // Mirrors getBookingDetail's finalPrice formula (laborCost + materialsCost
    // + addOns) so this stored snapshot doesn't undercount items the worker
    // added on-site.
    const addonsCost = booking.addOns.reduce((sum, addon) => sum + addon.price, 0);

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: 'QUOTE_APPROVED',
        quoteStatus: 'APPROVED',
        approvedAt: new Date(),
        finalPrice: booking.laborCost! + booking.materialsCost! + addonsCost,
      },
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
    const { reason, evidenceUrls } = req.body;
    // Optional — already-uploaded image URLs (see uploadController's
    // upload-then-attach pattern). Never required to file a legitimate
    // dispute.
    const cleanEvidenceUrls: string[] = Array.isArray(evidenceUrls)
      ? evidenceUrls.filter((url): url is string => typeof url === 'string')
      : [];

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
          evidenceUrls: cleanEvidenceUrls,
        },
      }),
    ]);

    // Notify worker (workerId is nullable on Booking — skip if unassigned)
    if (booking.workerId) {
      await notifyUser({
        userId: booking.workerId,
        type: 'DISPUTE_OPENED',
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
          type: 'DISPUTE_OPENED',
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
      include: { addOns: true },
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

    // Add-ons freeze right here — any still-pending one (never approved or
    // rejected) can no longer affect anything after this point, so resolve
    // it as rejected rather than leaving a dangling "Approve/Reject" prompt
    // the client could still tap on a job that's already done and billed.
    const stillPendingAddonIds = booking.addOns
      .filter((addon) => addon.clientApprovedAt == null && addon.clientRejectedAt == null)
      .map((addon) => addon.id);
    if (stillPendingAddonIds.length > 0) {
      await prisma.bookingAddOn.updateMany({
        where: { id: { in: stillPendingAddonIds } },
        data: { clientRejectedAt: new Date() },
      });
    }

    // Lock in the final billable subtotal now — only approved add-ons count
    // (see BookingAddOn.clientApprovedAt's schema comment) — this is what
    // the client pays at confirmation.
    const approvedAddOns = booking.addOns.filter((addon) => addon.clientApprovedAt != null);
    const { subtotal: lockedFinalPrice } = computeBookingFinalTotal({
      estimatedPrice: booking.estimatedPrice,
      laborCost: booking.laborCost,
      materialsCost: booking.materialsCost,
      tip: booking.tip,
      addOns: approvedAddOns,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status: 'PENDING_COMPLETION',
          completionPhotoUrl,
          workerCompletedAt: new Date(),
          finalPrice: lockedFinalPrice,
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
          await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot, booking.estimatedDurationHours);
        }

        // Same reasoning as cancelBooking's mirrored cleanup — releases any
        // never-claimed future calendar block this booking created via
        // /extend, now that the job it was reserved for is actually done.
        await tx.workerAvailability.updateMany({
          where: { workerProfileId: workerProfile.id, blockedByBookingId: booking.id, isBooked: false },
          data: { isBlocked: false, blockedByBookingId: null },
        });
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
 * Client confirms the worker's submitted proof of work — this is the payment
 * step. Payment method is locked to whatever the client chose at booking time.
 *
 *   CASH        -> settleCashBooking finalizes the booking immediately (the
 *                  client already paid the worker in person); responds
 *                  { status: 'COMPLETED' }.
 *   GCASH/MAYA  -> createCompletionInvoice raises a Xendit invoice for the full
 *                  final total, booking -> AWAITING_PAYMENT; responds
 *                  { status: 'AWAITING_PAYMENT', checkoutUrl, invoiceId }. The
 *                  invoice-paid webhook (finalizePaidBooking) finalizes it.
 *
 * activeJobCount/slot were already freed in completeBooking.
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

    // Allowed from PENDING_COMPLETION (first confirm) or AWAITING_PAYMENT
    // (client retrying an abandoned checkout).
    if (booking.status !== 'PENDING_COMPLETION' && booking.status !== 'AWAITING_PAYMENT') {
      return res
        .status(409)
        .json(errorResponse(409, `Cannot confirm completion for booking with status ${booking.status}`));
    }

    const method = booking.paymentMethodType ?? 'CASH';

    if (method === 'CASH') {
      const payment = await settleCashBooking(id);

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
        message: 'Completion confirmed — cash payment recorded',
        data: {
          id,
          status: 'COMPLETED',
          finalPrice: payment.subtotal,
          completedAt: payment.capturedAt,
          payment: {
            status: payment.status,
            methodType: payment.methodType,
            totalAmount: payment.totalAmount,
            workerPayout: payment.workerPayout,
          },
        },
      });
    }

    // GCASH / MAYA — raise the invoice, wait for the webhook.
    const invoice = await createCompletionInvoice(id);

    if ('alreadyPaid' in invoice) {
      // Xendit already shows this PAID (webhook missed/delayed) — createCompletionInvoice
      // self-healed it via finalizePaidBooking, so report COMPLETED instead of
      // handing back a checkout that would charge the client again.
      const payment = await prisma.payment.findUnique({ where: { bookingId: id } });
      return res.status(200).json({
        success: true,
        message: 'Completion confirmed — payment already received',
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
      message: 'Completion confirmed — payment required',
      data: {
        id,
        status: 'AWAITING_PAYMENT',
        checkoutUrl: invoice.checkoutUrl,
        invoiceId: invoice.invoiceId,
        amount: invoice.amount,
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
    const { reason, workerCancellationReason } = req.body as { reason?: string; workerCancellationReason?: string };

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

    // A booking a worker's spillover moved to a new date is the one
    // exception to the rule below — the client didn't choose to be moved,
    // so declining the new date is a free cancel, not backing out of a job
    // they already committed to. Resolved (explicitly kept, or auto-confirmed
    // — see remindAndAutoConfirmReschedules) the moment rescheduleAcknowledgedAt
    // is set, at which point this carve-out stops applying.
    const hasPendingReschedule = booking.rescheduledAt != null && booking.rescheduleAcknowledgedAt == null;

    // The other exception — the worker never showed up at all (see
    // bookingWorker.flagWorkerNoShows / Booking.workerNoShowFlaggedAt).
    // The client didn't choose this either, so it's the same free-cancel
    // carve-out as a forced reschedule.
    const hasWorkerNoShow = booking.workerNoShowFlaggedAt != null;

    // A client's cancellation window closes the moment a worker accepts —
    // by then the worker has committed real capacity and a calendar slot to
    // this job, so backing out is no longer the client's call (a worker
    // still can, from ACCEPTED onward, per the state machine below — e.g.
    // an emergency on their end). This is a hard rule, not a fee: there is
    // no "cancel for a charge" path past PENDING for the client, by design.
    if (req.user.role === 'CLIENT' && booking.status !== 'PENDING' && !hasPendingReschedule && !hasWorkerNoShow) {
      return res.status(409).json(
        errorResponse(
          409,
          'This booking has already been accepted and can no longer be cancelled. Please contact the worker or support if you need help.'
        )
      );
    }

    if (!isValidTransition(booking.status, 'CANCELLED')) {
      return res.status(409).json(errorResponse(409, `Cannot cancel booking with status ${booking.status}`));
    }

    const cancelledByRole = req.user.role === 'WORKER' ? 'WORKER' : 'CLIENT';

    // Required so a worker can distinguish "my fault" from "the client
    // wasn't there" or an unrelated reason — previously every late worker
    // cancellation was penalized identically regardless of whose fault it
    // actually was, which discouraged ever honestly reporting a client
    // no-show. Validated here rather than in the shared validation
    // middleware since it only applies when the CALLER turns out to be a
    // worker, which isn't known until after the booking/ownership lookup.
    const VALID_WORKER_CANCEL_REASONS = ['WORKER_FAULT', 'CLIENT_NO_SHOW', 'OTHER'];
    if (cancelledByRole === 'WORKER' && !VALID_WORKER_CANCEL_REASONS.includes(workerCancellationReason ?? '')) {
      return res.status(400).json(
        errorResponse(400, `workerCancellationReason must be one of ${VALID_WORKER_CANCEL_REASONS.join(', ')}`)
      );
    }

    // Notice given, in hours — feeds the auto-match penalty for repeated
    // last-minute cancellations (see B6 / matchingService's lateCancelCount).
    // Only meaningful for a WORKER backing out of a slot they'd already
    // committed to; clamped at 0 if the slot had already started.
    const cancelledWithinHours =
      cancelledByRole === 'WORKER' && booking.timeSlot
        ? Math.max(0, Math.round((getSlotStartInstant(booking.scheduledDate, booking.timeSlot).getTime() - Date.now()) / (60 * 60 * 1000)))
        : null;

    // Who (if anyone) takes the auto-match scoring penalty for this
    // cancellation — see Cancellation.penalizedWorkerId's schema comment.
    // Two paths set it: the worker self-reporting fault on a late cancel
    // (unchanged threshold/timing from the old cancelledBy='WORKER' logic),
    // or the client cancelling because this exact worker never showed up.
    const penalizedWorkerId =
      cancelledByRole === 'WORKER' &&
      workerCancellationReason === 'WORKER_FAULT' &&
      cancelledWithinHours != null &&
      cancelledWithinHours < LATE_CANCEL_THRESHOLD_HOURS
        ? req.user.userId
        : hasWorkerNoShow && booking.workerId
          ? booking.workerId
          : null;

    const updated = await prisma.$transaction(async (tx) => {
      // If the job was occupying capacity and a calendar slot, free both up.
      // Covers every pre-completion status the state machine allows a
      // cancel from (mobile's "Cancel Job" is enabled for all of these —
      // see canCancelJob in the worker job-detail screen), not just the
      // initial ACCEPTED state. A DISPUTED booking can also be reached
      // post-completion (AWAITING_PAYMENT -> DISPUTED, e.g. payment
      // overdue) where completeBooking already freed both — workerCompletedAt
      // being set is what distinguishes that case, so skip to avoid
      // double-freeing.
      if (
        booking.workerId &&
        !booking.workerCompletedAt &&
        ['ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED', 'DISPUTED'].includes(booking.status)
      ) {
        const workerProfile = await tx.workerProfile.update({
          where: { userId: booking.workerId },
          data: { activeJobCount: { decrement: 1 } },
        });
        if (booking.timeSlot) {
          await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot, booking.estimatedDurationHours);
        }
      }

      // Releases any never-claimed future calendar block this booking
      // created via /extend (see extendBooking) — otherwise a worker's
      // reserved spillover day survives the very booking that reserved it.
      // isBooked: false excludes a block a real different booking has since
      // moved into (see extendBooking's own move logic), which must stay put.
      if (booking.workerId) {
        const workerProfile = await tx.workerProfile.findUnique({
          where: { userId: booking.workerId },
          select: { id: true },
        });
        if (workerProfile) {
          await tx.workerAvailability.updateMany({
            where: { workerProfileId: workerProfile.id, blockedByBookingId: booking.id, isBooked: false },
            data: { isBlocked: false, blockedByBookingId: null },
          });
        }
      }

      // A booking cancelled outside dispute resolution (e.g. the worker
      // backing out of a DISPUTED job) ends whatever dispute was open on it —
      // otherwise it lingers in the admin queue with nothing left to resolve.
      await tx.dispute.updateMany({
        where: { bookingId: id, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
        data: {
          status: 'RESOLVED_DISMISSED',
          resolution: `Booking was cancelled by the ${cancelledByRole.toLowerCase()} before this dispute was resolved`,
          resolvedAt: new Date(),
        },
      });

      await tx.cancellation.create({
        data: {
          bookingId: id,
          cancelledBy: cancelledByRole,
          cancelledById: req.user!.userId,
          reason: hasPendingReschedule
            ? 'CLIENT_DECLINED_RESCHEDULE'
            : hasWorkerNoShow
              ? 'WORKER_NO_SHOW'
              : typeof reason === 'string'
                ? reason
                : null,
          cancelledWithinHours,
          workerCancellationReason: cancelledByRole === 'WORKER' ? (workerCancellationReason as WorkerCancellationReason) : null,
          penalizedWorkerId,
        },
      });

      return tx.booking.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          notes: reason, // schema has no cancelReason; storing in notes — kept as the client's own free-text reason even when Cancellation.reason is the CLIENT_DECLINED_RESCHEDULE tag
        },
      });
    });

    // Best-effort — same reasoning as accept/decline above.
    await cancelPendingExpiryJob(id).catch((error) => {
      console.error(`Failed to cancel pending-expiry job for cancelled booking ${id}:`, error);
    });
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

    // Mid-job only — before IN_PROGRESS there's no job happening yet to add
    // scope-creep items to, and once the worker has submitted completion
    // (PENDING_COMPLETION onward) the final price is already being settled.
    const ADDON_ALLOWED_STATUSES = ['IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED'];
    if (!ADDON_ALLOWED_STATUSES.includes(booking.status)) {
      return res.status(409).json(errorResponse(409, `Cannot add an addon to a booking with status ${booking.status}`));
    }

    // prisma client accessor is bookingAddOn (capital O). Starts pending —
    // see BookingAddOn.clientApprovedAt's schema comment — a worker
    // unilaterally adding a line item used to count toward the bill
    // instantly, with zero client consent.
    const addon = await prisma.bookingAddOn.create({
      data: {
        bookingId: id,
        name: name.trim(),
        price,
      },
    });

    await notifyUser({
      userId: booking.clientId,
      type: 'ADDON_ADDED',
      title: 'Approval needed: additional service added',
      message: `${addon.name} (₱${price}) was added to your booking and needs your approval before it's billed.`,
      relatedId: id,
    });

    return res.status(201).json({
      success: true,
      message: 'Addon added — awaiting client approval',
      data: addon,
    });
  } catch (error) {
    console.error('Error adding addon:', error);
    return res.status(500).json(errorResponse(500, 'Failed to add addon'));
  }
};

/**
 * PATCH /api/bookings/:id/addons/:addonId/respond
 * Client approves or rejects a pending mid-job addon (see addAddon /
 * BookingAddOn.clientApprovedAt). Only the pending state is actionable —
 * once resolved (by the client here, or by the reminder/auto-approve sweep,
 * or automatically at completion) it can't be re-answered.
 */
export const respondToAddon = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'CLIENT') {
      return res.status(403).json(errorResponse(403, 'Only clients can respond to an addon'));
    }

    const { id, addonId } = req.params as { id: string; addonId: string };
    const { approve } = req.body as { approve?: boolean };
    if (typeof approve !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'approve must be true or false'));
    }

    const addon = await prisma.bookingAddOn.findUnique({
      where: { id: addonId },
      include: { booking: { select: { id: true, clientId: true, workerId: true } } },
    });

    if (!addon || addon.bookingId !== id) {
      return res.status(404).json(errorResponse(404, 'Addon not found'));
    }
    if (addon.booking.clientId !== req.user.userId) {
      return res.status(403).json(errorResponse(403, 'This booking is not yours'));
    }
    if (addon.clientApprovedAt || addon.clientRejectedAt) {
      return res.status(409).json(errorResponse(409, 'This addon has already been resolved'));
    }

    const updated = await prisma.bookingAddOn.update({
      where: { id: addonId },
      data: approve ? { clientApprovedAt: new Date() } : { clientRejectedAt: new Date() },
    });

    if (addon.booking.workerId) {
      await notifyUser({
        userId: addon.booking.workerId,
        type: 'ADDON_ADDED',
        title: approve ? 'Addon approved' : 'Addon rejected',
        message: approve
          ? `The client approved "${addon.name}" (₱${addon.price}) — it'll be included in the final bill.`
          : `The client rejected "${addon.name}" (₱${addon.price}) — it won't be billed.`,
        relatedId: id,
      });
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error responding to addon:', error);
    return res.status(500).json(errorResponse(500, 'Failed to respond to addon'));
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

    // Update worker's average rating — aggregate in the DB instead of
    // pulling every review row (comment, photoUrls, etc.) just to reduce it.
    // status: VISIBLE matches adminReviewController.updateReview's own
    // recompute, so a HIDDEN review never counts toward the public rating.
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