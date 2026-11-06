import { Queue, type JobsOptions } from 'bullmq';
import { redisConnection as connection } from '@config/redis';

export const VERIFICATION_QUEUE_NAME = 'verification-ai';

export const VERIFICATION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 15_000 }, // ~15s, 30s
};

export interface VerificationJobDocument {
  documentType: string;
  fileUrl: string;
  mimeType: string | null;
  originalName: string | null;
}

export interface VerificationJobData {
  verificationId: string;
  requestType: string;
  documents: VerificationJobDocument[];
}

export const verificationQueue = new Queue<VerificationJobData>(VERIFICATION_QUEUE_NAME, { connection });

verificationQueue.on('error', (err) => {
  console.error('verificationQueue Redis connection error:', err.message);
});
