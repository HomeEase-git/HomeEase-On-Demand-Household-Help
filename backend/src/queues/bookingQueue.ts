import { Queue } from 'bullmq';
import { getAppSettings } from '@services/appSettingsService';
import { queueConnection as connection } from '@config/redis';

export const BOOKING_QUEUE_NAME = 'booking-lifecycle';

export const JOB_NAMES = {
  EXPIRE_PENDING: 'expire-pending-booking',
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings',
  QUOTE_TIMEOUT_SWEEP: 'quote-timeout-sweep',
  ADDON_TIMEOUT_SWEEP: 'addon-timeout-sweep',
  NO_SHOW_SWEEP: 'worker-no-show-sweep',
  DISPUTE_SLA_SWEEP: 'dispute-sla-sweep',
  RESCHEDULE_TIMEOUT_SWEEP: 'reschedule-timeout-sweep',
  RESCHEDULE_REQUEST_TIMEOUT_SWEEP: 'reschedule-request-timeout-sweep',
  KYC_EXPIRY_SWEEP: 'kyc-expiry-sweep',
  AUTO_SUSPEND_SWEEP: 'auto-suspend-sweep',
  LOCATION_CLEANUP_SWEEP: 'worker-location-cleanup-sweep',
} as const;

// Stable jobIds for the repeatable ticks so re-registering them on every
// boot (see index.ts) upserts the schedule instead of piling up duplicates.
export const REPEATABLE_JOB_IDS = {
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings-hourly',
  QUOTE_TIMEOUT_SWEEP: 'quote-timeout-sweep-hourly',
  ADDON_TIMEOUT_SWEEP: 'addon-timeout-sweep-hourly',
  NO_SHOW_SWEEP: 'worker-no-show-sweep-hourly',
  DISPUTE_SLA_SWEEP: 'dispute-sla-sweep-hourly',
  RESCHEDULE_TIMEOUT_SWEEP: 'reschedule-timeout-sweep-hourly',
  RESCHEDULE_REQUEST_TIMEOUT_SWEEP: 'reschedule-request-timeout-sweep-hourly',
  KYC_EXPIRY_SWEEP: 'kyc-expiry-sweep-hourly',
  AUTO_SUSPEND_SWEEP: 'auto-suspend-sweep-hourly',
  LOCATION_CLEANUP_SWEEP: 'worker-location-cleanup-sweep-hourly',
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
 * 60). jobId = bookingId so accepting/rejecting/cancelling the booking
 * before it fires can remove this exact job (see cancelPendingExpiryJob).
 */
export async function schedulePendingExpiry(bookingId: string): Promise<void> {
  const { pendingExpiryMinutes } = await getAppSettings();
  const minutes = Math.max(1, Math.round(pendingExpiryMinutes));

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
 * Registers the repeatable ticks (hourly settle, hourly quote sweep, the
 * 10-minute no-show sweep, ...) via BullMQ v6's Job Scheduler API. Idempotent —
 * upsertJobScheduler upserts by jobSchedulerId (REPEATABLE_JOB_IDS.*), so
 * calling this on every server boot is safe and keeps the schedule in sync
 * with the pattern defined here.
 *
 * This replaces the pre-v6 `queue.add(name, data, { repeat, jobId })` form —
 * `repeat` is no longer a valid JobsOptions field; repeatable/scheduled jobs
 * now go through this dedicated scheduler API instead.
 */
// Schedulers for sweeps that no longer exist (time slots were removed) —
// deleted on boot so an old deployment's registrations don't keep firing.
const RETIRED_JOB_SCHEDULER_IDS = ['reset-expired-availability-slots-daily', 'materialize-availability-templates-daily'];

export async function registerRepeatableBookingJobs(): Promise<void> {
  for (const id of RETIRED_JOB_SCHEDULER_IDS) {
    await bookingQueue.removeJobScheduler(id).catch(() => undefined);
  }

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.AUTO_SETTLE_COMPLETED,
    { pattern: '0 * * * *' }, // every hour, on the hour
    {
      name: JOB_NAMES.AUTO_SETTLE_COMPLETED,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.QUOTE_TIMEOUT_SWEEP,
    { pattern: '0 * * * *' }, // every hour, on the hour
    {
      name: JOB_NAMES.QUOTE_TIMEOUT_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.ADDON_TIMEOUT_SWEEP,
    { pattern: '0 * * * *' }, // every hour, on the hour
    {
      name: JOB_NAMES.ADDON_TIMEOUT_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.NO_SHOW_SWEEP,
    // Every 10 minutes — a no-show is cancelled AppSettings.noShowGraceMinutes
    // after the start time, so an hourly tick could be up to an hour late.
    { pattern: '*/10 * * * *' },
    {
      name: JOB_NAMES.NO_SHOW_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.DISPUTE_SLA_SWEEP,
    { pattern: '0 * * * *' }, // every hour, on the hour
    {
      name: JOB_NAMES.DISPUTE_SLA_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.RESCHEDULE_TIMEOUT_SWEEP,
    { pattern: '0 * * * *' }, // every hour, on the hour
    {
      name: JOB_NAMES.RESCHEDULE_TIMEOUT_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.RESCHEDULE_REQUEST_TIMEOUT_SWEEP,
    { pattern: '0 * * * *' }, // every hour, on the hour
    {
      name: JOB_NAMES.RESCHEDULE_REQUEST_TIMEOUT_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.KYC_EXPIRY_SWEEP,
    { pattern: '0 * * * *' }, // every hour, on the hour
    {
      name: JOB_NAMES.KYC_EXPIRY_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.AUTO_SUSPEND_SWEEP,
    { pattern: '0 * * * *' }, // every hour, on the hour
    {
      name: JOB_NAMES.AUTO_SUSPEND_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.LOCATION_CLEANUP_SWEEP,
    { pattern: '0 * * * *' }, // every hour, on the hour
    {
      name: JOB_NAMES.LOCATION_CLEANUP_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );
}
