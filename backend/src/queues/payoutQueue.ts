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

payoutQueue.on('error', (err) => {
  console.error('payoutQueue Redis connection error:', err.message);
});

export async function schedulePayout(payoutId: string): Promise<void> {
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
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: false, // keep failed jobs visible for inspection/retry
    }
  );
}
