import { Queue } from 'bullmq';
import type { UrgencyLevel } from '@prisma/client';
import { getAppSettings } from '@services/appSettingsService';
import { queueConnection as connection } from '@config/redis';

// Scales AppSettings.pendingExpiryMinutes (the STANDARD-urgency base, still
// admin-configurable exactly as before) down for faster-turnaround bookings
// — at the 60min default this works out to 60/30/15, matching the product
// decision. Relative rather than absolute values so an admin changing the
// base setting scales every urgency tier with it instead of only STANDARD.
export const EXPIRY_MULTIPLIER: Record<UrgencyLevel, number> = {
  STANDARD: 1,
  URGENT: 0.5,
  EMERGENCY: 0.25,
};

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

// Mandatory per BullMQ's own docs — Queue re-emits its Redis connection's
// errors as an 'error' event, and an EventEmitter with no 'error' listener
// crashes the whole process on the first one (e.g. Redis unreachable at
// boot). Log-and-continue: the bounded retries in queueConnection already
// decide when this queue gives up trying to reconnect.
bookingQueue.on('error', (err) => {
  console.error('bookingQueue Redis connection error:', err.message);
});

/**
 * Schedules the PENDING→CANCELLED expiry check for a newly-created booking,
 * after AppSettings.pendingExpiryMinutes (admin-configurable, defaults to
 * 60), scaled down by urgencyLevel (see EXPIRY_MULTIPLIER above) — an
 * EMERGENCY booking shouldn't sit waiting on the same clock as a STANDARD
 * one. jobId = bookingId so accepting/rejecting/cancelling the booking
 * before it fires can remove this exact job (see cancelPendingExpiryJob).
 */
export async function schedulePendingExpiry(bookingId: string, urgencyLevel: UrgencyLevel = 'STANDARD'): Promise<void> {
  const { pendingExpiryMinutes } = await getAppSettings();
  const minutes = Math.max(1, Math.round(pendingExpiryMinutes * EXPIRY_MULTIPLIER[urgencyLevel]));

  await bookingQueue.add(
    JOB_NAMES.EXPIRE_PENDING,
    { bookingId } satisfies ExpirePendingBookingJobData,
    {
      // BullMQ rejects ':' in custom jobIds (reserved for its own Redis key
      // namespacing) — '-' instead, kept in sync with cancelPendingExpiryJob.
      jobId: `${JOB_NAMES.EXPIRE_PENDING}-${bookingId}`,
      delay: minutes * 60 * 1000,
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
