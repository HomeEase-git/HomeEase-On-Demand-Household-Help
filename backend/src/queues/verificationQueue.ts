import { Queue } from 'bullmq';
import { redisConnection as connection } from '@config/redis';

export const VERIFICATION_QUEUE_NAME = 'verification-ai';

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
