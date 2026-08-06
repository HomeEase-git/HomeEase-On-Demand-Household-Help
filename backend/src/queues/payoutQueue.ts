import { Queue } from 'bullmq';
import { redisConnection as connection } from '@config/redis';

export const PAYOUT_QUEUE_NAME = 'worker-payout';

export const PAYOUT_JOB_NAMES = {
  SEND_PAYOUT: 'send-payout',
} as const;

export interface SendPayoutJobData {
  payoutId: string;
}

export const payoutQueue = new Queue(PAYOUT_QUEUE_NAME, { connection });

/**
 * Queues a worker payout for disbursement. Async by design — escrow release
 * happens in the booking-completion request path and in an hourly cron tick
 * (autoSettleCompletedBookings); calling PayMongo synchronously there would
 * block responses and couple a PayMongo outage to escrow-release success.
 * jobId = payoutId so re-scheduling (e.g. an admin retry) upserts rather
 * than piling up duplicate jobs for the same payout.
 */
export async function schedulePayout(payoutId: string): Promise<void> {
  await payoutQueue.add(
    PAYOUT_JOB_NAMES.SEND_PAYOUT,
    { payoutId } satisfies SendPayoutJobData,
    {
      jobId: `${PAYOUT_JOB_NAMES.SEND_PAYOUT}:${payoutId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: false, // keep failed jobs visible for inspection/retry
    }
  );
}
