import prisma from '@config/database';
import { isWithinRadiusKm } from '@utils/geo';
import { offersTaskFilter } from '@services/taskPriceService';
import { workerSetupCompleteWhere } from '@services/workerSetupService';
import { availableOnDateWhere } from '@services/workerAvailabilityService';

const DEFAULT_SERVICE_AREA_RADIUS_KM = 30;

export interface MatchCandidate {
  workerId: string;
  rating: number;
  completedJobs: number;
  lateCancelCount?: number;
}

export interface ScoredCandidate extends MatchCandidate {
  score: number;
}

export const MATCH_WEIGHTS = {
  rating: 0.6,
  completedJobs: 0.3,
  randomness: 0.1,
} as const;

export const LATE_CANCEL_THRESHOLD_HOURS = 24;
export const LATE_CANCEL_LOOKBACK_DAYS = 90;
export const LATE_CANCEL_PENALTY_WEIGHT = 0.15;
export const LATE_CANCEL_PENALTY_CAP = 3;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

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
    const lateCancelPenalty = LATE_CANCEL_PENALTY_WEIGHT * clamp01((c.lateCancelCount ?? 0) / LATE_CANCEL_PENALTY_CAP);

    const score =
      MATCH_WEIGHTS.rating * ratingScore +
      MATCH_WEIGHTS.completedJobs * completedScore +
      MATCH_WEIGHTS.randomness * randomScore -
      lateCancelPenalty;

    return { ...c, score };
  });
}

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
  hasPets?: boolean;
  excludeWorkerIds?: string[];
  clientLat?: number | null;
  clientLng?: number | null;
}

export interface AutoMatchResult {
  workerId: string;
  workerProfileId: string;
  score: number;
}

export async function findAutoMatchWorker(params: AutoMatchParams): Promise<AutoMatchResult | null> {
  const {
    serviceType,
    serviceTaskId,
    date,
    hasPets,
    excludeWorkerIds = [],
    clientLat,
    clientLng,
  } = params;

  const workers = await prisma.workerProfile.findMany({
    where: {
      kycStatus: 'APPROVED',
      isAvailable: true,
      debtHoldAt: null,
      userId: excludeWorkerIds.length > 0 ? { notIn: excludeWorkerIds } : undefined,
      OR: [{ declineCooldownUntil: null }, { declineCooldownUntil: { lte: new Date() } }],
      serviceCategories: { some: { status: 'VERIFIED', serviceType: { name: { equals: serviceType, mode: 'insensitive' } } } },
      ...(hasPets ? { acceptsPets: true } : {}),
      ...(serviceTaskId ? offersTaskFilter(serviceTaskId) : {}),
      AND: [workerSetupCompleteWhere(), availableOnDateWhere(date)],
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

  const lateCancelSince = new Date(Date.now() - LATE_CANCEL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const lateCancelCounts = await prisma.cancellation.groupBy({
    by: ['penalizedWorkerId'],
    where: {
      penalizedWorkerId: { in: inRangeWorkers.map((w) => w.userId) },
      createdAt: { gte: lateCancelSince },
    },
    _count: { _all: true },
  });
  const lateCancelByWorkerId = new Map(
    lateCancelCounts.map((c) => [c.penalizedWorkerId as string, c._count._all])
  );

  const candidates: (MatchCandidate & { workerProfileId: string })[] = inRangeWorkers.map((w) => ({
    workerId: w.userId,
    workerProfileId: w.id,
    rating: w.rating,
    completedJobs: completedByWorkerId.get(w.userId) ?? 0,
    lateCancelCount: lateCancelByWorkerId.get(w.userId) ?? 0,
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
