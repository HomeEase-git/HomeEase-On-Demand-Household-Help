// Real payoutQueue.ts connects to Redis via BullMQ, same as bookingQueue.ts/
// verificationQueue.ts (see those mocks) — tests don't have a Redis
// instance available. This one was missed when those two were mocked out;
// settleWorkerEarnings/settlePlatformFundedPayment call schedulePayout as a
// side effect once a Payment actually settles, and with no mock here that
// hit real, unreachable Redis on every such test — individually bounded by
// queueConnection's retry budget, but compounding across the suite into
// real, avoidable slowdown once enough tests reach a completed payment.
export const PAYOUT_QUEUE_NAME = 'worker-payout';

export const PAYOUT_JOB_NAMES = {
  SEND_PAYOUT: 'send-payout',
} as const;

export const payoutQueue = {
  add: jest.fn().mockResolvedValue(undefined),
  getJob: jest.fn().mockResolvedValue(null),
};

export const schedulePayout = jest.fn().mockResolvedValue(undefined);
