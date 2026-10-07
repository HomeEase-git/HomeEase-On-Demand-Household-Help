import { Queue } from 'bullmq';
import { queueConnection as connection } from '@config/redis';

export const PAYOUT_QUEUE_NAME = 'worker-payout';

export const PAYOUT_JOB_NAMES = {
  SEND_PAYOUT: 'send-payout',
} as const;

export interface SendPayoutJobData {
  payoutId: string;
}

export const payoutQueue = new Queue(PAYOUT_QUEUE_NAME, { connection });

// Mandatory per BullMQ's own docs — see the identical note in
// bookingQueue.ts.
payoutQueue.on('error', (err) => {
  console.error('payoutQueue Redis connection error:', err.message);
});

/**
 * Queues a worker payout for disbursement. Async by design — escrow release
 * happens in the booking-completion request path and in an hourly cron tick
 * (autoSettleCompletedBookings); calling Xendit synchronously there would
 * block responses and couple a Xendit outage to escrow-release success.
 * jobId = payoutId so re-scheduling (e.g. an admin retry) upserts rather
 * than piling up duplicate jobs for the same payout.
 */
export async function schedulePayout(payoutId: string): Promise<void> {
  // BullMQ silently ignores add() for a jobId that still exists — and failed
  // jobs are kept (removeOnFail: false). Clear a finished job first so an
  // admin retry or the re-enqueue sweep actually runs again. A waiting,
  // delayed or active job is left alone: the add below is then a no-op.
  const jobId = `${PAYOUT_JOB_NAMES.SEND_PAYOUT}-${payoutId}`;
  const previous = await payoutQueue.getJob(jobId);
  if (previous) {
    const state = await previous.getState();
    if (state === 'failed' || state === 'completed') await previous.remove();
  }

  await payoutQueue.add(
    PAYOUT_JOB_NAMES.SEND_PAYOUT,
    { payoutId } satisfies SendPayoutJobData,
    {
      // BullMQ rejects ':' in custom jobIds (reserved for its own Redis key
      // namespacing) — '-' instead.
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: false, // keep failed jobs visible for inspection/retry
    }
  );
}
