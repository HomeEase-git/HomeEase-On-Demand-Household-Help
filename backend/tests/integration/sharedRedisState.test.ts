/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto';

let redisServer: any;
const instances: Array<{ limiter: any; revocation: any }> = [];
const originalRedisUrl = process.env.REDIS_URL;

beforeAll(async () => {
  const { RedisMemoryServer } = require('redis-memory-server');
  redisServer = new RedisMemoryServer();
  process.env.REDIS_URL = `redis://${await redisServer.getHost()}:${await redisServer.getPort()}`;
  for (let i = 0; i < 2; i++) {
    jest.isolateModules(() => {
      instances.push({ limiter: require('@utils/otpAttemptLimiter'), revocation: require('@utils/tokenRevocation') });
    });
  }
}, 60_000);

afterAll(async () => {
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
  await redisServer?.stop();
});

describe('per-account state shared through Redis', () => {
  it('a clear on one instance unlocks the account on the other', async () => {
    const [a, b] = instances;
    const userId = randomUUID();
    const { MAX_OTP_ATTEMPTS } = b.limiter;
    for (let i = 1; i <= MAX_OTP_ATTEMPTS; i++) {
      expect(await b.limiter.recordFailedOtpAttempt(userId, 'LOGIN_PASSWORD', 600)).toBe(i);
    }
    expect(await a.limiter.isOtpAttemptLocked(userId, 'LOGIN_PASSWORD')).toBe(true);
    expect(await b.limiter.isOtpAttemptLocked(userId, 'LOGIN_PASSWORD')).toBe(true);

    await a.limiter.clearOtpAttempts(userId, 'LOGIN_PASSWORD');
    expect(await b.limiter.isOtpAttemptLocked(userId, 'LOGIN_PASSWORD')).toBe(false);
  });

  it('a reinstatement on one instance is honoured by the other', async () => {
    const [a, b] = instances;
    const userId = randomUUID();
    await b.revocation.revokeUserSessions(userId, 900);
    expect(await a.revocation.isUserSessionRevoked(userId)).toBe(true);

    await a.revocation.clearUserSessionRevocation(userId);
    expect(await b.revocation.isUserSessionRevoked(userId)).toBe(false);
  });
});
