import type Redis from 'ioredis';
import type { Options } from 'express-rate-limit';
import { RedisFallbackStore, resetRateLimitCircuit } from '@middleware/rateLimitStore';

// Just enough of ioredis for the store: INCR/PTTL in a MULTI, PEXPIRE, DECR, DEL.
function fakeRedis() {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  let down = false;
  const fail = () => {
    if (down) throw new Error('connect ECONNREFUSED');
  };
  const redis = {
    multi() {
      const ops: Array<() => [null, number]> = [];
      const chain = {
        incr(key: string) {
          ops.push(() => {
            counts.set(key, (counts.get(key) ?? 0) + 1);
            return [null, counts.get(key)!];
          });
          return chain;
        },
        pttl(key: string) {
          ops.push(() => [null, expiries.has(key) ? expiries.get(key)! - Date.now() : -1]);
          return chain;
        },
        async exec() {
          fail();
          return ops.map((op) => op());
        },
      };
      return chain;
    },
    async pexpire(key: string, ms: number) {
      fail();
      expiries.set(key, Date.now() + ms);
    },
    async decr(key: string) {
      fail();
      counts.set(key, (counts.get(key) ?? 0) - 1);
    },
    async del(key: string) {
      fail();
      counts.delete(key);
    },
  };
  return {
    redis: redis as unknown as Redis,
    counts,
    setDown: (value: boolean) => {
      down = value;
    },
  };
}

const options = { windowMs: 60_000 } as Options;

describe('RedisFallbackStore', () => {
  beforeEach(() => resetRateLimitCircuit());

  it('shares one count between instances', async () => {
    const shared = fakeRedis();
    const serverA = new RedisFallbackStore('rl:test:', () => shared.redis);
    const serverB = new RedisFallbackStore('rl:test:', () => shared.redis);
    serverA.init(options);
    serverB.init(options);

    await serverA.increment('1.2.3.4');
    await serverB.increment('1.2.3.4');
    const third = await serverA.increment('1.2.3.4');

    expect(third.totalHits).toBe(3);
    expect(third.resetTime!.getTime()).toBeGreaterThan(Date.now() + 55_000);
    expect(shared.counts.get('rl:test:1.2.3.4')).toBe(3);
    serverA.shutdown();
    serverB.shutdown();
  });

  it('keeps counting in memory when Redis is down, and uses Redis again once it recovers', async () => {
    const shared = fakeRedis();
    const store = new RedisFallbackStore('rl:test:', () => shared.redis);
    store.init(options);

    shared.setDown(true);
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push((await store.increment('5.6.7.8')).totalHits);
    expect(hits).toEqual([1, 2, 3, 4]); // limits still apply, per instance

    shared.setDown(false);
    resetRateLimitCircuit(); // cooldown elapsed
    expect((await store.increment('5.6.7.8')).totalHits).toBe(1); // back on the shared counter
    store.shutdown();
  });

  it('undoes a hit on the counter that recorded it, even after Redis recovers', async () => {
    const shared = fakeRedis();
    const store = new RedisFallbackStore('rl:test:', () => shared.redis);
    store.init(options);
    await store.increment('9.9.9.9'); // counted in Redis
    await store.increment('9.9.9.9');

    shared.setDown(true);
    await store.increment('9.9.9.9'); // Redis down: counted in memory
    shared.setDown(false);
    resetRateLimitCircuit();

    await store.decrement('9.9.9.9'); // that request succeeded
    expect(shared.counts.get('rl:test:9.9.9.9')).toBe(2); // shared count untouched, never lowered
    store.shutdown();
  });

  it('decrements and resets keys', async () => {
    const shared = fakeRedis();
    const store = new RedisFallbackStore('rl:test:', () => shared.redis);
    store.init(options);
    await store.increment('k');
    await store.increment('k');
    await store.decrement('k');
    expect(shared.counts.get('rl:test:k')).toBe(1);
    await store.resetKey('k');
    expect(shared.counts.has('rl:test:k')).toBe(false);
    store.shutdown();
  });
});
