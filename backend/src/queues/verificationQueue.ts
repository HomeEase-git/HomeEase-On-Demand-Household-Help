import { Queue } from 'bullmq';

export const VERIFICATION_QUEUE_NAME = 'verification-ai';

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
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
