import { useBookingStore } from "../store/bookingStore";

const MAX_CONCURRENT_JOBS = 2;

const ACTIVE_STATUSES = ['Accepted', 'Active', 'InProgress', 'QuoteSubmitted', 'QuoteApproved'];

/**
 * useWorkerCapacity
 *
 * Returns capacity info for a given worker based on their
 * active bookings in the store. Use this on the booking flow
 * to warn clients or block selection when a worker is full.
 *
 * Usage:
 *   const { isAtCapacity, activeJobCount } = useWorkerCapacity(workerId, scheduledDate);
 */
export function useWorkerCapacity(workerId: string | null, scheduledDate?: string | null) {
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

  const activeJobsForWorker = bookings.filter(
    (b) => b.workerId === workerId && ACTIVE_STATUSES.includes(b.status as string),
  );

  const activeJobCount = activeJobsForWorker.length;
  const isAtCapacity = activeJobCount >= MAX_CONCURRENT_JOBS;

  const isUnavailableForDate = Boolean(
    scheduledDate && activeJobsForWorker.some((b) => b.date === scheduledDate),
  );

  const reason = isAtCapacity
    ? 'Worker at capacity'
    : isUnavailableForDate
      ? 'Worker already has a job on this date'
      : undefined;

  return {
    isAtCapacity,
    activeJobCount,
    maxJobs: MAX_CONCURRENT_JOBS,
    canAcceptJob: !isAtCapacity && !isUnavailableForDate,
    isUnavailableForDate,
    reason,
  };
}
