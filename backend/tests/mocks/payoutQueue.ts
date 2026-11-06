export const PAYOUT_QUEUE_NAME = 'worker-payout';

export const PAYOUT_JOB_NAMES = {
  SEND_PAYOUT: 'send-payout',
} as const;

export const payoutQueue = {
  add: jest.fn().mockResolvedValue(undefined),
  getJob: jest.fn().mockResolvedValue(null),
};

export const schedulePayout = jest.fn().mockResolvedValue(undefined);
