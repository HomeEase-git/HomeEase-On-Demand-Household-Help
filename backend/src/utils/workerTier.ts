export type WorkerTier = 'STANDARD' | 'PRO' | 'EXPERT';

export interface WorkerTierSettings {
  tierProMinRating: number;
  tierProMinJobs: number;
  tierProMinYears: number;
  tierProMultiplier: number;
  tierExpertMinRating: number;
  tierExpertMinJobs: number;
  tierExpertMinYears: number;
  tierExpertMultiplier: number;
}

export interface WorkerTierStats {
  rating: number;
  // Jobs completed on HomeEase.
  completedJobs: number;
  // Years in the trade, including work outside the platform
  // (WorkerProfile.yearsExperience). Unknown counts as 0.
  yearsExperience: number | null | undefined;
}

/**
 * Tier is computed on the fly from live rating, completed-job count and
 * years of experience rather than stored on WorkerProfile, so it never
 * drifts from those numbers. A tier needs every one of its requirements.
 * EXPERT is checked first since its thresholds are a superset of PRO's.
 */
export function computeWorkerTier(stats: WorkerTierStats, settings: WorkerTierSettings): WorkerTier {
  const years = stats.yearsExperience ?? 0;
  if (
    stats.rating >= settings.tierExpertMinRating &&
    stats.completedJobs >= settings.tierExpertMinJobs &&
    years >= settings.tierExpertMinYears
  ) {
    return 'EXPERT';
  }
  if (
    stats.rating >= settings.tierProMinRating &&
    stats.completedJobs >= settings.tierProMinJobs &&
    years >= settings.tierProMinYears
  ) {
    return 'PRO';
  }
  return 'STANDARD';
}

export function tierMultiplier(tier: WorkerTier, settings: WorkerTierSettings): number {
  if (tier === 'EXPERT') return settings.tierExpertMultiplier;
  if (tier === 'PRO') return settings.tierProMultiplier;
  return 1.0;
}
