// Shared BullMQ connection options — used by the three queues (bookingQueue,
// payoutQueue, verificationQueue) and their matching workers, so Redis
// connection settings live in exactly one place.
//
// Most managed Redis (Render Key Value, Upstash, Railway, ...) hands you one
// connection string instead of separate host/port/password — REDIS_URL takes
// priority when set; REDIS_HOST/PORT/PASSWORD (what local dev and
// docker-compose use) are the fallback. rediss:// enables TLS, matching what
// those providers require for external connections.
function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

const baseConnection = process.env.REDIS_URL
  ? parseRedisUrl(process.env.REDIS_URL)
  : {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    };

// For Queue producers (the `.add()` side — bookingQueue/payoutQueue so far).
// Bounded retries so a Redis outage surfaces as a fast, visible error on
// the request that tried to schedule a job (e.g. booking creation) instead
// of hanging indefinitely — ioredis's own defaults retry forever with no
// cap.
export const queueConnection = {
  ...baseConnection,
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 2000)),
};

// For Worker consumers (bookingWorker/payoutWorker so far). BullMQ requires
// `maxRetriesPerRequest: null` here — its blocking commands (BRPOPLPUSH
// etc.) need unbounded retries, and setting this otherwise makes BullMQ
// throw on worker startup. Workers are long-running background processes
// anyway, so retrying indefinitely to reconnect is the right behavior for
// them (unlike a request-scoped queue.add() call).
export const workerConnection = {
  ...baseConnection,
  maxRetriesPerRequest: null as null,
};

// Legacy: verificationQueue/verificationWorker still import this directly.
// Deliberately left as-is (unbounded retries, ioredis's own defaults) rather
// than switched to queueConnection/workerConnection here, since those two
// files have separate in-progress changes of their own right now — bundling
// an unrelated Redis-config swap into that diff isn't worth the risk.
// Worth moving verificationQueue onto queueConnection (for the same
// fail-fast behavior bookingQueue/payoutQueue now have) once that other
// work lands.
export const redisConnection = baseConnection;
