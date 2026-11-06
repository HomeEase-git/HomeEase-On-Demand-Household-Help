const DEFAULT_MAX_CONCURRENT_JOBS = 2;

export function useWorkerCapacity(
  activeJobCount: number | null | undefined,
  maxConcurrentJobs: number | null | undefined,
) {
  const count = activeJobCount ?? 0;
  const maxJobs = maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS;
  const isAtCapacity = count >= maxJobs;

  return {
    isAtCapacity,
    activeJobCount: count,
    maxJobs,
    canAcceptJob: !isAtCapacity,
    reason: isAtCapacity ? 'Worker at capacity' : undefined,
  };
}
