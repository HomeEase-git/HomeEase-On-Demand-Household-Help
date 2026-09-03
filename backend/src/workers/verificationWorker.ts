import { Worker } from 'bullmq';
import { analyzeVerificationDocuments, recordExhaustedRetriesFallback } from '@services/verificationAiService';
import prisma from '@config/database';
import { redisConnection as connection } from '@config/redis';
import { VERIFICATION_QUEUE_NAME, type VerificationJobData } from '@queues/verificationQueue';

export async function startVerificationWorker() {
  const worker = new Worker<VerificationJobData>(
    VERIFICATION_QUEUE_NAME,
    async (job) => {
      const { verificationId, requestType, documents } = job.data;

      const verification = await prisma.verificationRequest.findUnique({ where: { id: verificationId } });
      if (!verification) {
        // Don't throw — retrying can't fix a request that no longer exists
        // (deleted user, etc.), so this shouldn't burn retry attempts.
        console.warn(`Verification job ${job.id}: request ${verificationId} not found, skipping.`);
        return { success: false, reason: 'not_found' };
      }

      await analyzeVerificationDocuments(verificationId, requestType, documents);
      return { success: true };
    },
    { connection }
  );

  worker.on('failed', async (job, err) => {
    console.error(`Verification job ${job?.id} failed`, err);
    if (!job) return;

    // BullMQ re-queues this job automatically up to `attempts` times (see
    // VERIFICATION_JOB_OPTIONS) — only degrade to the heuristic fallback
    // once this was truly the last attempt, so a request that will succeed
    // on retry #2 doesn't get prematurely marked as failed.
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    try {
      await recordExhaustedRetriesFallback(job.data.verificationId, job.data.requestType, job.data.documents, err);
    } catch (writeError) {
      console.error(`Failed to record fallback for verification ${job.data.verificationId}`, writeError);
    }
  });

  // Mandatory per BullMQ's own docs — see the identical note in
  // bookingQueue.ts. Distinct from 'failed' above: that's a job that ran
  // and errored, this is the worker's own Redis connection dropping.
  worker.on('error', (err) => {
    console.error('verificationWorker Redis connection error:', err.message);
  });

  return worker;
}
