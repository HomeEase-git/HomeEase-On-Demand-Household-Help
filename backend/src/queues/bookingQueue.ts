import { Queue } from 'bullmq';
import { getAppSettings } from '@services/appSettingsService';
import { queueConnection as connection } from '@config/redis';

export const BOOKING_QUEUE_NAME = 'booking-lifecycle';

export const JOB_NAMES = {
  EXPIRE_PENDING: 'expire-pending-booking',
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings',
  NO_SHOW_SWEEP: 'worker-no-show-sweep',
  STUCK_BOOKING_SWEEP: 'stuck-booking-sweep',
  DISPUTE_SLA_SWEEP: 'dispute-sla-sweep',
  RESCHEDULE_TIMEOUT_SWEEP: 'reschedule-timeout-sweep',
  RESCHEDULE_REQUEST_TIMEOUT_SWEEP: 'reschedule-request-timeout-sweep',
  KYC_EXPIRY_SWEEP: 'kyc-expiry-sweep',
  AUTO_SUSPEND_SWEEP: 'auto-suspend-sweep',
  LOCATION_CLEANUP_SWEEP: 'worker-location-cleanup-sweep',
  DATA_RETENTION_SWEEP: 'data-retention-sweep',
} as const;

export const REPEATABLE_JOB_IDS = {
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings-hourly',
  NO_SHOW_SWEEP: 'worker-no-show-sweep-hourly',
  STUCK_BOOKING_SWEEP: 'stuck-booking-sweep-10min',
  DISPUTE_SLA_SWEEP: 'dispute-sla-sweep-hourly',
  RESCHEDULE_TIMEOUT_SWEEP: 'reschedule-timeout-sweep-hourly',
  RESCHEDULE_REQUEST_TIMEOUT_SWEEP: 'reschedule-request-timeout-sweep-hourly',
  KYC_EXPIRY_SWEEP: 'kyc-expiry-sweep-hourly',
  AUTO_SUSPEND_SWEEP: 'auto-suspend-sweep-hourly',
  LOCATION_CLEANUP_SWEEP: 'worker-location-cleanup-sweep-hourly',
  DATA_RETENTION_SWEEP: 'data-retention-sweep-daily',
} as const;

export interface ExpirePendingBookingJobData {
  bookingId: string;
}

export const bookingQueue = new Queue(BOOKING_QUEUE_NAME, { connection });

bookingQueue.on('error', (err) => {
  console.error('bookingQueue Redis connection error:', err.message);
});

export async function schedulePendingExpiry(bookingId: string): Promise<void> {
  const { pendingExpiryMinutes } = await getAppSettings();
  const minutes = Math.max(1, Math.round(pendingExpiryMinutes));

  await bookingQueue.add(
    JOB_NAMES.EXPIRE_PENDING,
    { bookingId } satisfies ExpirePendingBookingJobData,
    {
      jobId: `${JOB_NAMES.EXPIRE_PENDING}-${bookingId}`,
      delay: minutes * 60 * 1000,
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}

export async function cancelPendingExpiryJob(bookingId: string): Promise<void> {
  const job = await bookingQueue.getJob(`${JOB_NAMES.EXPIRE_PENDING}-${bookingId}`);
  if (job) {
    await job.remove().catch(() => {
    });
  }
}

const RETIRED_JOB_SCHEDULER_IDS = [
  'reset-expired-availability-slots-daily',
  'materialize-availability-templates-daily',
  'quote-timeout-sweep-hourly',
  'addon-timeout-sweep-hourly',
];

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
    REPEATABLE_JOB_IDS.NO_SHOW_SWEEP,
    { pattern: '*/10 * * * *' },
    {
      name: JOB_NAMES.NO_SHOW_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );

  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.STUCK_BOOKING_SWEEP,
    { pattern: '*/10 * * * *' },
    {
      name: JOB_NAMES.STUCK_BOOKING_SWEEP,
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
  await bookingQueue.upsertJobScheduler(
    REPEATABLE_JOB_IDS.DATA_RETENTION_SWEEP,
    { pattern: '40 3 * * *' }, // daily, 03:40 server time
    {
      name: JOB_NAMES.DATA_RETENTION_SWEEP,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );
}
