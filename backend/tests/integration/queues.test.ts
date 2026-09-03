// Runs against a real (ephemeral) Redis via redis-memory-server — separate
// from the main suite (see jest.integration.config.js) because the main
// suite mocks these exact modules out. This is the only automated check
// that would have caught the "BullMQ rejects ':' in custom jobIds" bug:
// bookingQueue.ts and payoutQueue.ts both built their jobId as
// `${jobName}:${id}`, which threw on every real .add() call once a real
// Redis was reachable, but never on the mocked queue the rest of the suite
// uses.
/* eslint-disable @typescript-eslint/no-explicit-any */

let redisServer: any;
let bookingQueueModule: any;
let payoutQueueModule: any;
let verificationQueueModule: any;

beforeAll(async () => {
  const { RedisMemoryServer } = require('redis-memory-server');
  redisServer = new RedisMemoryServer();

  // config/redis.ts reads REDIS_HOST/REDIS_PORT at module-load time, so
  // these must be set before the queue modules below are first required.
  process.env.REDIS_HOST = await redisServer.getHost();
  process.env.REDIS_PORT = String(await redisServer.getPort());

  bookingQueueModule = require('@queues/bookingQueue');
  payoutQueueModule = require('@queues/payoutQueue');
  verificationQueueModule = require('@queues/verificationQueue');
}, 60_000);

afterAll(async () => {
  await bookingQueueModule?.bookingQueue.close();
  await payoutQueueModule?.payoutQueue.close();
  await verificationQueueModule?.verificationQueue.close();
  await redisServer?.stop();
});

describe('BullMQ queues against a real Redis', () => {
  it('schedulePendingExpiry accepts a cuid-shaped bookingId without throwing', async () => {
    const bookingId = `test-booking-id-${Date.now()}`;
    await expect(bookingQueueModule.schedulePendingExpiry(bookingId)).resolves.toBeUndefined();
    await bookingQueueModule.cancelPendingExpiryJob(bookingId);
  });

  it('schedulePayout accepts a cuid-shaped payoutId without throwing', async () => {
    const payoutId = `test-payout-id-${Date.now()}`;
    await expect(payoutQueueModule.schedulePayout(payoutId)).resolves.toBeUndefined();
  });

  it('verificationQueue.add accepts a real job without throwing', async () => {
    const job = await verificationQueueModule.verificationQueue.add(
      'verify',
      {
        verificationId: `test-verification-id-${Date.now()}`,
        requestType: 'WORKER_ONBOARDING',
        documents: [],
      },
      verificationQueueModule.VERIFICATION_JOB_OPTIONS
    );
    expect(job.id).toBeTruthy();
    await job.remove();
  });
});
