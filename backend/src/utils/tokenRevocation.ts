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
const client = new Redis({
  ...redisConnection,
  maxRetriesPerRequest: 1,
  commandTimeout: 1500,
});

client.on('error', (err) => {
  console.error('Token-revocation Redis connection error:', err.message);
});

const REVOKED_KEY_PREFIX = 'revoked:user:';

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
  try {
    await client.set(`${REVOKED_KEY_PREFIX}${userId}`, '1', 'EX', ttlSeconds);
  } catch (error: any) {
    console.error(`Failed to revoke sessions for user ${userId} in Redis:`, error?.message ?? error);
  }
}

/** Called on reinstatement (setUserStatus back to ACTIVE). */
export async function clearUserSessionRevocation(userId: string): Promise<void> {
  try {
    await client.del(`${REVOKED_KEY_PREFIX}${userId}`);
  } catch (error: any) {
    console.error(`Failed to clear session revocation for user ${userId} in Redis:`, error?.message ?? error);
  }
}

/** See the fail-open note on `client` above. */
export async function isUserSessionRevoked(userId: string): Promise<boolean> {
  try {
    const value = await client.get(`${REVOKED_KEY_PREFIX}${userId}`);
    return value === '1';
  } catch (error: any) {
    console.error(`Failed to check session revocation for user ${userId} in Redis:`, error?.message ?? error);
    return false;
  }
}
