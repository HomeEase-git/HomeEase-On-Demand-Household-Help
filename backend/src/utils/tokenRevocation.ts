import Redis from 'ioredis';
import { redisConnection } from '@config/redis';

// Dedicated connection for the ban/suspend session-revocation check in
// authMiddleware — deliberately separate from the BullMQ queue/worker
// connections in config/redis.ts. Those are allowed to block/retry
// indefinitely (or up to a bounded few seconds for a request-scoped
// enqueue); this one sits on the hot path of every authenticated request,
// so it needs a short timeout and a small retry budget, and — critically —
// it must FAIL OPEN. If Redis is unreachable, a request is let through
// rather than every authenticated endpoint on the platform going down on a
// Redis blip. That narrows what "revoked" guarantees: normally near-
// instant, degrading to "within the access token's own expiry" during a
// Redis outage — exactly the guarantee that existed before this feature,
// so an outage here is a regression to the old behavior, not a new hole.
// `lazyConnect` + a bounded `retryStrategy` (same shape as config/redis.ts's
// own `queueConnection`) are both required, not just the fail-open try/catch
// below: ioredis's default retryStrategy retries forever with backoff, and
// that reconnect loop is a live timer/socket that keeps the Node process
// alive even after every test/request finishes — which is exactly what made
// CI's `npm test` hang indefinitely on this branch (no Redis service
// container in that job at all, so this client had nothing to connect to
// and kept trying forever in the background). Returning null from
// retryStrategy after a few attempts lets ioredis actually give up and the
// process exit normally; a later call still auto-reconnects and gets a
// fresh bounded attempt, so production fail-open behavior is unaffected.
const client = new Redis({
  ...redisConnection,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  commandTimeout: 1500,
  retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
});

// Swallow ioredis's own 'error' events past the first one in a row — every
// failed connection attempt emits one (Node would otherwise crash the
// process on an unhandled 'error' event with no listener at all), and
// without de-duplication this doubles up with the circuit breaker's own
// logging below on every single failure.
let loggedConnectionError = false;
client.on('error', (err) => {
  if (!loggedConnectionError) {
    console.error('Token-revocation Redis connection error (further errors suppressed until it recovers):', err.message);
    loggedConnectionError = true;
  }
});
client.on('connect', () => {
  loggedConnectionError = false;
});

const REVOKED_KEY_PREFIX = 'revoked:user:';

// Circuit breaker. Without this, every authenticated request in an
// environment with no reachable Redis (this backend's own test suite; CI's
// `backend` job, which runs no Redis service at all; local dev without one
// started) pays a full doomed connection attempt on every single call —
// individually cheap, but compounding across hundreds of requests into
// real, avoidable slowdown (this is what turned a ~45s full local test run
// into 120s+ once tests actually exercised authenticated routes deeply
// enough for it to matter). After a few consecutive failures, stop even
// trying for a cooldown window and go straight to the fail-open path; a
// real, live Redis (production) recovers on its own the moment `connect`
// fires again.
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function circuitIsOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

function recordFailure(context: string, error: unknown): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && circuitOpenUntil < Date.now()) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.error(
      `Token-revocation Redis unreachable after ${consecutiveFailures} failures — skipping it for ${CIRCUIT_COOLDOWN_MS / 1000}s (last call: ${context}):`,
      (error as any)?.message ?? error
    );
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

/**
 * Marks every access token currently held by this user as revoked for the
 * next `ttlSeconds` — pass the JWT's own max lifetime (see utils/jwt.ts's
 * JWT_EXPIRY): no token minted before this call can possibly outlive that
 * window, so there's no reason to keep the Redis key around any longer.
 * Called from adminUserController.setUserStatus on any transition away
 * from ACTIVE. Combined with deleting the user's AuthToken rows there
 * (blocks refresh), this is what makes a ban/suspend take effect
 * immediately instead of only once every already-issued access token
 * happens to expire naturally on its own (up to JWT_EXPIRY, 7 days by
 * default in production).
 */
export async function revokeUserSessions(userId: string, ttlSeconds: number): Promise<void> {
  if (circuitIsOpen()) return;
  try {
    await client.set(`${REVOKED_KEY_PREFIX}${userId}`, '1', 'EX', ttlSeconds);
    recordSuccess();
  } catch (error) {
    recordFailure('revokeUserSessions', error);
  }
}

/** Called on reinstatement (setUserStatus back to ACTIVE). */
export async function clearUserSessionRevocation(userId: string): Promise<void> {
  if (circuitIsOpen()) return;
  try {
    await client.del(`${REVOKED_KEY_PREFIX}${userId}`);
    recordSuccess();
  } catch (error) {
    recordFailure('clearUserSessionRevocation', error);
  }
}

/** See the fail-open note on `client` above. */
export async function isUserSessionRevoked(userId: string): Promise<boolean> {
  if (circuitIsOpen()) return false;
  try {
    const value = await client.get(`${REVOKED_KEY_PREFIX}${userId}`);
    recordSuccess();
    return value === '1';
  } catch (error) {
    recordFailure('isUserSessionRevoked', error);
    return false;
  }
}
