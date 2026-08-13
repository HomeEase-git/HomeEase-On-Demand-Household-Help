export type WorkerTier = 'STANDARD' | 'PRO' | 'EXPERT';

export interface WorkerTierSettings {
  tierProMinRating: number;
  tierProMinJobs: number;
  tierProMultiplier: number;
  tierExpertMinRating: number;
  tierExpertMinJobs: number;
  tierExpertMultiplier: number;
}

/**
 * Tier is computed on the fly from live rating + completed-job count rather
 * than stored on WorkerProfile, so it never drifts from those numbers.
 * EXPERT is checked first since its thresholds are a superset of PRO's.
 */
export function computeWorkerTier(
  rating: number,
  completedJobs: number,
  settings: WorkerTierSettings
): WorkerTier {
  if (rating >= settings.tierExpertMinRating && completedJobs >= settings.tierExpertMinJobs) {
    return 'EXPERT';
  }
  if (rating >= settings.tierProMinRating && completedJobs >= settings.tierProMinJobs) {
    return 'PRO';
  }
  return 'STANDARD';
}

export function tierMultiplier(tier: WorkerTier, settings: WorkerTierSettings): number {
  if (tier === 'EXPERT') return settings.tierExpertMultiplier;
  if (tier === 'PRO') return settings.tierProMultiplier;
  return 1.0;
}
