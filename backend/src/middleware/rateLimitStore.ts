import Redis from 'ioredis';
import { MemoryStore, type IncrementResponse, type Options, type Store } from 'express-rate-limit';
import { redisConnection } from '@config/redis';

// Rate-limit counters shared through Redis, so every backend instance (and
// the old + new instance during a deploy) counts against the same limit —
// with per-instance memory counters, N instances means N× the allowance.
//
// If Redis is unreachable the counters fall back to this instance's memory
// rather than letting everything through: limits get looser (per instance),
// never switched off. Same short-timeout, bounded-retry, circuit-breaker
// approach as utils/tokenRevocation.ts, and nothing here can reject
// unhandled (index.ts treats that as fatal).

const redisConfigured = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);

let client: Redis | null = null;
let loggedConnectionError = false;

function getClient(): Redis {
  if (!client) {
    client = new Redis({
      ...redisConnection,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
    });
    client.on('error', (err) => {
      if (!loggedConnectionError) {
        console.error('Rate-limit Redis connection error (further errors suppressed until it recovers):', err.message);
        loggedConnectionError = true;
      }
    });
    client.on('connect', () => {
      loggedConnectionError = false;
    });
  }
  return client;
}

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

const circuitIsOpen = () => Date.now() < circuitOpenUntil;

function recordFailure(error: unknown): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && circuitOpenUntil < Date.now()) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.error(
      `Rate-limit Redis unreachable after ${consecutiveFailures} failures — using per-instance counters for ${CIRCUIT_COOLDOWN_MS / 1000}s:`,
      (error as Error)?.message ?? error,
    );
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

/**
 * Fixed-window counter: INCR the key, and give it the window as its expiry
 * the first time it's seen (PTTL < 0), which also repairs a key whose expiry
 * was lost between the two commands.
 */
export class RedisFallbackStore implements Store {
  prefix: string;
  localKeys = false;
  private windowMs = 60_000;
  private readonly memory = new MemoryStore();

  constructor(prefix: string, private readonly redis: () => Redis = getClient) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (circuitIsOpen()) return this.memory.increment(key);
    const redisKey = `${this.prefix}${key}`;
    try {
      const redis = this.redis();
      const results = await redis.multi().incr(redisKey).pttl(redisKey).exec();
      if (!results || results.some(([error]) => error)) throw results?.find(([error]) => error)?.[0] ?? new Error('Redis MULTI failed');
      const totalHits = Number(results[0][1]);
      let msLeft = Number(results[1][1]);
      if (msLeft < 0) {
        await redis.pexpire(redisKey, this.windowMs);
        msLeft = this.windowMs;
      }
      recordSuccess();
      return { totalHits, resetTime: new Date(Date.now() + msLeft) };
    } catch (error) {
      recordFailure(error);
      return this.memory.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    if (circuitIsOpen()) return this.memory.decrement(key);
    try {
      await this.redis().decr(`${this.prefix}${key}`);
      recordSuccess();
    } catch (error) {
      recordFailure(error);
      await this.memory.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.memory.resetKey(key);
    if (circuitIsOpen()) return;
    try {
      await this.redis().del(`${this.prefix}${key}`);
      recordSuccess();
    } catch (error) {
      recordFailure(error);
    }
  }

  shutdown(): void {
    this.memory.shutdown();
  }
}

/** A shared Redis store when Redis is configured; otherwise this instance's memory (the default). */
export const rateLimitStore = (prefix: string): Store | undefined =>
  redisConfigured ? new RedisFallbackStore(prefix) : undefined;

/** For tests: forget the circuit breaker state. */
export function resetRateLimitCircuit(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}
