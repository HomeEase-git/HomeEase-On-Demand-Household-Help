import { Worker } from 'bullmq';
import { analyzeVerificationDocuments } from '@services/verificationAiService';
import prisma from '@config/database';
import { VERIFICATION_QUEUE_NAME, type VerificationJobData } from '@queues/verificationQueue';

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};

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
