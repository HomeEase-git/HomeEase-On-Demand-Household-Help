const DEFAULT_MAX_CONCURRENT_JOBS = 2;

/**
 * useWorkerCapacity
 *
 * Derives a capacity badge from the server-authoritative activeJobCount/
 * maxConcurrentJobs already returned on each worker card by GET /workers
 * (workerController.searchWorkers) — NOT from local booking state. Actual
 * capacity enforcement happens server-side (createBooking/acceptBooking);
 * this is a display-only hint, and since at-capacity workers are already
 * filtered out of search results, isAtCapacity will normally be false for
 * anything this hook is called on.
 *
 * Usage:
 *   const { isAtCapacity, activeJobCount } = useWorkerCapacity(worker.activeJobCount, worker.maxConcurrentJobs);
 */
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
