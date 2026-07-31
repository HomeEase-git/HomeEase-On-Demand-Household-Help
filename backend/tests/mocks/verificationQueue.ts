// Real verificationQueue.ts connects to Redis via BullMQ. Tests don't have a
// Redis instance available, so this stand-in is swapped in via jest's
// moduleNameMapper — no test currently exercises the rerun/AI-review path.
export const VERIFICATION_QUEUE_NAME = 'verification-ai';

export const verificationQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};