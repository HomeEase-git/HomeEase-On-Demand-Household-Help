import { Queue } from 'bullmq';
import { getAppSettings } from '@services/appSettingsService';
import { redisConnection as connection } from '@config/redis';

export const BOOKING_QUEUE_NAME = 'booking-lifecycle';

export const JOB_NAMES = {
  EXPIRE_PENDING: 'expire-pending-booking',
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings',
  QUOTE_TIMEOUT_SWEEP: 'quote-timeout-sweep',
  RESET_AVAILABILITY: 'reset-expired-availability-slots',
} as const;

// Stable jobIds for the repeatable ticks so re-registering them on every
// boot (see index.ts) upserts the schedule instead of piling up duplicates.
export const REPEATABLE_JOB_IDS = {
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings-hourly',
  QUOTE_TIMEOUT_SWEEP: 'quote-timeout-sweep-hourly',
  RESET_AVAILABILITY: 'reset-expired-availability-slots-daily',
} as const;

export interface ExpirePendingBookingJobData {
  bookingId: string;
}

export const bookingQueue = new Queue(BOOKING_QUEUE_NAME, { connection });

/**
 * Schedules the PENDING→CANCELLED expiry check for a newly-created booking,
 * after AppSettings.pendingExpiryMinutes (admin-configurable, defaults to
 * 60). jobId = bookingId so accepting/rejecting/cancelling the booking
 * before it fires can remove this exact job (see cancelPendingExpiryJob).
 */
export async function schedulePendingExpiry(bookingId: string): Promise<void> {
  const { pendingExpiryMinutes } = await getAppSettings();

  await bookingQueue.add(
    JOB_NAMES.EXPIRE_PENDING,
    { bookingId } satisfies ExpirePendingBookingJobData,
    {
      // BullMQ rejects ':' in custom jobIds (reserved for its own Redis key
      // namespacing) — '-' instead, kept in sync with cancelPendingExpiryJob.
      jobId: `${JOB_NAMES.EXPIRE_PENDING}-${bookingId}`,
      delay: pendingExpiryMinutes * 60 * 1000,
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}

/**
 * Cancels a scheduled expiry check — call this whenever a booking leaves
 * PENDING through any path other than the expiry job itself (accept,
 * decline, client cancel), so a stale job doesn't fire against a booking
 * that already moved on.
 */
export async function cancelPendingExpiryJob(bookingId: string): Promise<void> {
  const job = await bookingQueue.getJob(`${JOB_NAMES.EXPIRE_PENDING}-${bookingId}`);
  if (job) {
    await job.remove().catch(() => {
      // Already picked up by the worker or removed — safe to ignore.
    });
  }
}

/**
 * Registers the repeatable ticks (hourly settle, hourly quote sweep, daily
 * availability reset). Idempotent — BullMQ upserts by (name, repeat pattern,
 * jobId), so calling this on every server boot is safe and keeps the
 * schedule in sync with the pattern defined here.
 */
export async function registerRepeatableBookingJobs(): Promise<void> {
  await bookingQueue.add(
    JOB_NAMES.AUTO_SETTLE_COMPLETED,
    {},
    {
      jobId: REPEATABLE_JOB_IDS.AUTO_SETTLE_COMPLETED,
      repeat: { pattern: '0 * * * *' }, // every hour, on the hour
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  await bookingQueue.add(
    JOB_NAMES.QUOTE_TIMEOUT_SWEEP,
    {},
    {
      jobId: REPEATABLE_JOB_IDS.QUOTE_TIMEOUT_SWEEP,
      repeat: { pattern: '0 * * * *' }, // every hour, on the hour
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  await bookingQueue.add(
    JOB_NAMES.RESET_AVAILABILITY,
    {},
    {
      jobId: REPEATABLE_JOB_IDS.RESET_AVAILABILITY,
      repeat: { pattern: '0 0 * * *' }, // daily at midnight
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}
