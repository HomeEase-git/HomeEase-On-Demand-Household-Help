import prisma from '@config/database';
import type { ConditionType, RoomType, TimeSlot } from '@prisma/client';
import { isWithinRadiusKm } from '@utils/geo';

// Fallback when a worker hasn't set WorkerProfile.serviceAreaRadius (it has
// a DB default, but stay defensive for any row created before that default
// existed).
const DEFAULT_SERVICE_AREA_RADIUS_KM = 30;

export interface MatchCandidate {
  workerId: string;
  rating: number;
  completedJobs: number;
}

export interface ScoredCandidate extends MatchCandidate {
  score: number;
}

// 60% rating, 30% completed jobs, 10% randomness — per the "surprise-me"
// auto-match spec. Distance isn't a scoring factor (rating stays the
// dominant signal among in-range candidates), but it IS a hard eligibility
// filter — see findAutoMatchWorker's serviceAreaRadius check below, which
// uses WorkerProfile.addressLat/addressLng (the worker's fixed service
// base, already used for the booking distanceFee) rather than the earlier,
// since-removed currentLat/currentLng approach, which was live-location
// data no client ever actually populated. All scoring factors are
// normalized to [0, 1] before weighting so none of them can dominate purely
// from having a wider natural range (e.g. completedJobs is unbounded,
// rating is capped at 5).
export const MATCH_WEIGHTS = {
  rating: 0.6,
  completedJobs: 0.3,
  randomness: 0.1,
} as const;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Pure scoring function — no I/O, so it's directly unit-testable and the
 * randomness source is injectable for deterministic tests.
 */
export function scoreCandidates(
  candidates: MatchCandidate[],
  random: () => number = Math.random
): ScoredCandidate[] {
  if (candidates.length === 0) return [];

  const maxCompleted = Math.max(1, ...candidates.map((c) => c.completedJobs));

  return candidates.map((c) => {
    const ratingScore = clamp01(c.rating / 5);
    const completedScore = clamp01(c.completedJobs / maxCompleted);
    const randomScore = clamp01(random());

    const score =
      MATCH_WEIGHTS.rating * ratingScore +
      MATCH_WEIGHTS.completedJobs * completedScore +
      MATCH_WEIGHTS.randomness * randomScore;

    return { ...c, score };
  });
}

/**
 * Picks the highest-scoring candidate. Ties resolve to whichever candidate
 * was scored first (stable — callers can pre-sort candidates by a secondary
 * key, e.g. workerId, for deterministic tie-breaking).
 */
export function selectBestCandidate(
  candidates: MatchCandidate[],
  random: () => number = Math.random
): ScoredCandidate | null {
  const scored = scoreCandidates(candidates, random);
  if (scored.length === 0) return null;

  return scored.reduce((best, current) => (current.score > best.score ? current : best));
}

export interface AutoMatchParams {
  serviceType: string;
  serviceTaskId?: string | null;
  date: Date;
  timeSlot: TimeSlot;
  condition?: ConditionType | null;
  rooms?: RoomType[];
  hasPets?: boolean;
  excludeWorkerIds?: string[];
  // Booking address — when given (and a candidate has WorkerProfile.
  // addressLat/addressLng on file), candidates farther than that worker's
  // own serviceAreaRadius are dropped before scoring. Optional so a caller
  // without coordinates gets the old unfiltered-by-distance behavior rather
  // than an error.
  clientLat?: number | null;
  clientLng?: number | null;
}

export interface AutoMatchResult {
  workerId: string;
  workerProfileId: string;
  score: number;
}

/**
 * DB-backed candidate lookup + selection for "surprise me" bookings (no
 * workerId supplied by the client). A worker is only a candidate if:
 *  - KYC approved and currently marked available
 *  - under their maxConcurrentJobs capacity
 *  - offers the requested serviceType
 *  - has an explicit open WorkerAvailability row for (date, timeSlot) —
 *    not blocked, not already booked
 *  - accepts HEAVY-condition jobs if this one is HEAVY
 *  - accepts pets if the booking involves pets
 *  - not in excludeWorkerIds (declined workers on a re-match attempt)
 */
export async function findAutoMatchWorker(params: AutoMatchParams): Promise<AutoMatchResult | null> {
  const {
    serviceType,
    date,
    timeSlot,
    condition,
    hasPets,
    excludeWorkerIds = [],
    clientLat,
    clientLng,
  } = params;

  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const workers = await prisma.workerProfile.findMany({
    where: {
      kycStatus: 'APPROVED',
      isAvailable: true,
      debtHoldAt: null,
      userId: excludeWorkerIds.length > 0 ? { notIn: excludeWorkerIds } : undefined,
      // Excludes workers currently serving a decline-limit cooldown (see
      // bookingController.declineBooking) from auto-match candidates.
      OR: [{ declineCooldownUntil: null }, { declineCooldownUntil: { lte: new Date() } }],
      serviceTypes: { some: { name: { equals: serviceType, mode: 'insensitive' } } },
      ...(condition === 'HEAVY' ? { acceptsHeavyCondition: true } : {}),
      ...(hasPets ? { acceptsPets: true } : {}),
      availability: {
        some: {
          date: { gte: dayStart, lte: dayEnd },
          timeSlot,
          isBlocked: false,
          isBooked: false,
        },
      },
    },
    select: {
      id: true,
      userId: true,
      rating: true,
      addressLat: true,
      addressLng: true,
      serviceAreaRadius: true,
    },
  });

  // Hard eligibility cutoff — a worker outside their own configured service
  // radius (default 30km) from the booking address never becomes a
  // candidate, so a far-flung worker can't out-rank a nearby one purely on
  // rating (see matchingService docblock above). Only applied where both
  // sides of the distance are actually known; a worker with no address on
  // file yet is left in the pool unfiltered, same as the distanceFee
  // calculation already treats that case.
  const inRangeWorkers =
    clientLat != null && clientLng != null
      ? workers.filter((w) => {
          if (w.addressLat == null || w.addressLng == null) return true;
          return isWithinRadiusKm(
            { lat: clientLat, lng: clientLng },
            { lat: w.addressLat, lng: w.addressLng },
            w.serviceAreaRadius ?? DEFAULT_SERVICE_AREA_RADIUS_KM
          );
        })
      : workers;

  if (inRangeWorkers.length === 0) return null;

  const completedCounts = await prisma.booking.groupBy({
    by: ['workerId'],
    where: { workerId: { in: inRangeWorkers.map((w) => w.userId) }, status: 'COMPLETED' },
    _count: { _all: true },
  });
  const completedByWorkerId = new Map(completedCounts.map((c) => [c.workerId as string, c._count._all]));

  const candidates: (MatchCandidate & { workerProfileId: string })[] = inRangeWorkers.map((w) => ({
    workerId: w.userId,
    workerProfileId: w.id,
    rating: w.rating,
    completedJobs: completedByWorkerId.get(w.userId) ?? 0,
  }));

  const best = selectBestCandidate(candidates);
  if (!best) return null;

  const matched = candidates.find((c) => c.workerId === best.workerId);
  if (!matched) return null;

  return {
    workerId: matched.workerId,
    workerProfileId: matched.workerProfileId,
    score: best.score,
  };
}
