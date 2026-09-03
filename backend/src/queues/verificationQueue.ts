import { Queue, type JobsOptions } from 'bullmq';
import { redisConnection as connection } from '@config/redis';

export const VERIFICATION_QUEUE_NAME = 'verification-ai';

// Retries transient AI-review failures (Anthropic rate limits/5xx, a
// document URL that didn't fetch this time) with exponential backoff before
// the worker's `failed` handler gives up and degrades to the heuristic
// fallback. Shared by both places that enqueue a review (initial upload and
// admin "Re-run AI Review") so the policy can't drift between them.
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
