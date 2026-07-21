import { useBookingStore } from "../store/bookingStore";
import { workers } from "../constants/dummyData";

const MAX_CONCURRENT_JOBS = 2;

/**
 * useWorkerCapacity
 *
 * Returns capacity info for a given worker based on their
 * active bookings in the store. Use this on the booking flow
 * to warn clients or block selection when a worker is full.
 *
 * Usage:
 *   const { isAtCapacity, activeJobCount } = useWorkerCapacity(workerId);
 */
export function useWorkerCapacity(workerId: string | null) {
  const bookings = useBookingStore((s) => s.bookings);

  if (!workerId) {
    return {
      isAtCapacity: false,
      activeJobCount: 0,
      maxJobs: MAX_CONCURRENT_JOBS,
      canAcceptJob: true,
      isUnavailableForDate: false,
      reason: undefined,
    };
  }

  // Map workerId to display name where possible for backwards compatibility
  const workerRecord = workers.find((w) => w.id === workerId);
  const workerName = workerRecord ? workerRecord.name : null;

  const activeJobCount = bookings.filter((b) => {
    const matchesWorker = workerName ? b.worker === workerName : b.worker === workerId;
    const activeStatuses = ['Accepted', 'Active', 'InProgress', 'QuoteSubmitted', 'QuoteApproved'];
    return matchesWorker && activeStatuses.includes(b.status as string);
  }).length;

  const isAtCapacity = activeJobCount >= MAX_CONCURRENT_JOBS;

  return {
    isAtCapacity,
    activeJobCount,
    maxJobs: MAX_CONCURRENT_JOBS,
    canAcceptJob: !isAtCapacity,
    isUnavailableForDate: false,
    reason: isAtCapacity ? 'Worker at capacity' : undefined,
  };
}