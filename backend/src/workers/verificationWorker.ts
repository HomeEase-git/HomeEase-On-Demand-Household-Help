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

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    try {
      await recordExhaustedRetriesFallback(job.data.verificationId, job.data.requestType, job.data.documents, err);
    } catch (writeError) {
      console.error(`Failed to record fallback for verification ${job.data.verificationId}`, writeError);
    }
  });

  worker.on('error', (err) => {
    console.error('verificationWorker Redis connection error:', err.message);
  });

  return worker;
}
