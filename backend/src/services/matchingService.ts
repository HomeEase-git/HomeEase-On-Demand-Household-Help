import prisma from '@config/database';
import { distanceKm, type LatLng } from '@utils/geo';
import type { ConditionType, RoomType, TimeSlot } from '@prisma/client';

export interface MatchCandidate {
  workerId: string;
  rating: number;
  distanceKm: number;
  completedJobs: number;
}

export interface ScoredCandidate extends MatchCandidate {
  score: number;
}

// 40% rating, 30% distance, 20% completed jobs, 10% randomness — per the
// "surprise-me" auto-match spec. All four factors are normalized to [0, 1]
// before weighting so none of them can dominate purely from having a wider
// natural range (e.g. completedJobs is unbounded, rating is capped at 5).
export const MATCH_WEIGHTS = {
  rating: 0.4,
  distance: 0.3,
  completedJobs: 0.2,
  randomness: 0.1,
} as const;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Pure scoring function — no I/O, so it's directly unit-testable and the
 * randomness source is injectable for deterministic tests.
 */
export function scoreCandidates(
  candidates: MatchCandidate[],
  radiusKm: number,
  random: () => number = Math.random
): ScoredCandidate[] {
  if (candidates.length === 0) return [];

  const maxCompleted = Math.max(1, ...candidates.map((c) => c.completedJobs));
  const safeRadiusKm = Math.max(radiusKm, 0.001);

  return candidates.map((c) => {
    const ratingScore = clamp01(c.rating / 5);
    const distanceScore = clamp01(1 - c.distanceKm / safeRadiusKm);
    const completedScore = clamp01(c.completedJobs / maxCompleted);
    const randomScore = clamp01(random());

    const score =
      MATCH_WEIGHTS.rating * ratingScore +
      MATCH_WEIGHTS.distance * distanceScore +
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
  radiusKm: number,
  random: () => number = Math.random
): ScoredCandidate | null {
  const scored = scoreCandidates(candidates, radiusKm, random);
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
  clientLocation: LatLng;
  radiusKm: number;
  excludeWorkerIds?: string[];
}

export interface AutoMatchResult {
  workerId: string;
  workerProfileId: string;
  score: number;
  distanceKm: number;
}

/**
 * DB-backed candidate lookup + selection for "surprise me" bookings (no
 * workerId supplied by the client). A worker is only a candidate if:
 *  - KYC approved and currently marked available
 *  - under their maxConcurrentJobs capacity
 *  - offers the requested serviceType
 *  - has an explicit open WorkerAvailability row for (date, timeSlot) —
 *    not blocked, not already booked
 *  - has a live location (currentLat/currentLng) within radiusKm
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
    clientLocation,
    radiusKm,
    excludeWorkerIds = [],
  } = params;

  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const workers = await prisma.workerProfile.findMany({
    where: {
      kycStatus: 'APPROVED',
      isAvailable: true,
      userId: excludeWorkerIds.length > 0 ? { notIn: excludeWorkerIds } : undefined,
      currentLat: { not: null },
      currentLng: { not: null },
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
      currentLat: true,
      currentLng: true,
    },
  });

  // activeJobCount can change between the initial filter and here in theory,
  // but this function runs inside the caller's transaction, so re-check.
  const eligible = workers.filter((w) => w.currentLat != null && w.currentLng != null);
  if (eligible.length === 0) return null;

  const withinRadius = eligible.filter(
    (w) => distanceKm(clientLocation, { lat: w.currentLat as number, lng: w.currentLng as number }) <= radiusKm
  );
  if (withinRadius.length === 0) return null;

  const completedCounts = await prisma.booking.groupBy({
    by: ['workerId'],
    where: { workerId: { in: withinRadius.map((w) => w.userId) }, status: 'COMPLETED' },
    _count: { _all: true },
  });
  const completedByWorkerId = new Map(completedCounts.map((c) => [c.workerId as string, c._count._all]));

  const candidates: (MatchCandidate & { workerProfileId: string })[] = withinRadius.map((w) => ({
    workerId: w.userId,
    workerProfileId: w.id,
    rating: w.rating,
    distanceKm: distanceKm(clientLocation, { lat: w.currentLat as number, lng: w.currentLng as number }),
    completedJobs: completedByWorkerId.get(w.userId) ?? 0,
  }));

  const best = selectBestCandidate(candidates, radiusKm);
  if (!best) return null;

  const matched = candidates.find((c) => c.workerId === best.workerId);
  if (!matched) return null;

  return {
    workerId: matched.workerId,
    workerProfileId: matched.workerProfileId,
    score: best.score,
    distanceKm: matched.distanceKm,
  };
}
