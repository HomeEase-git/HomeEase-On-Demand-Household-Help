import { Worker } from 'bullmq';
import { analyzeVerificationDocuments } from '@services/verificationAiService';
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
        throw new Error('Verification request not found');
      }

      await analyzeVerificationDocuments(verificationId, requestType, documents);
      return { success: true };
    },
    { connection }
  );

  worker.on('failed', (job, err) => {
    console.error(`Verification job ${job?.id} failed`, err);
  });

  return worker;
}
