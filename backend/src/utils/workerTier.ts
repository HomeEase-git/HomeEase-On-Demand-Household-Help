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
  yearsExperience: number | null | undefined;
}

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
