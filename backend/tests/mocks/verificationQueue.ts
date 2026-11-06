export const VERIFICATION_QUEUE_NAME = 'verification-ai';

export const VERIFICATION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 15_000 },
};

export const verificationQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};