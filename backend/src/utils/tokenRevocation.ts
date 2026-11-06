import Redis from 'ioredis';
import { redisConnection } from '@config/redis';

const client = new Redis({
  ...redisConnection,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  commandTimeout: 1500,
  retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
});

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

export interface RevocationListener {
  onUserRevoked(userId: string): void;
  onSessionsRevoked(sessionIds: string[]): void;
}

let revocationListener: RevocationListener | null = null;

export function setRevocationListener(listener: RevocationListener | null): void {
  revocationListener = listener;
}

const REVOKED_KEY_PREFIX = 'revoked:user:';
const REVOKED_SESSION_KEY_PREFIX = 'revoked:session:';

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

// ponytail: per-process mirror — covers the single Render instance; with
const localRevocations = new Map<string, number>(); // key -> expiry (ms)

function rememberLocally(key: string, ttlSeconds: number): void {
  const now = Date.now();
  if (localRevocations.size >= 10_000) {
    for (const [k, expiresAt] of localRevocations) if (expiresAt <= now) localRevocations.delete(k);
  }
  localRevocations.set(key, now + ttlSeconds * 1000);
}

function revokedLocally(key: string): boolean {
  const expiresAt = localRevocations.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt > Date.now()) return true;
  localRevocations.delete(key);
  return false;
}

export async function revokeUserSessions(userId: string, ttlSeconds: number): Promise<void> {
  revocationListener?.onUserRevoked(userId);
  const key = `${REVOKED_KEY_PREFIX}${userId}`;
  if (circuitIsOpen()) return rememberLocally(key, ttlSeconds);
  try {
    await client.set(key, '1', 'EX', ttlSeconds);
    recordSuccess();
  } catch (error) {
    recordFailure('revokeUserSessions', error);
    rememberLocally(key, ttlSeconds);
  }
}

export async function clearUserSessionRevocation(userId: string): Promise<void> {
  localRevocations.delete(`${REVOKED_KEY_PREFIX}${userId}`);
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
  if (revokedLocally(`${REVOKED_KEY_PREFIX}${userId}`)) return true;
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

export async function revokeSessionIds(sessionIds: string[], ttlSeconds: number): Promise<void> {
  if (sessionIds.length === 0) return;
  revocationListener?.onSessionsRevoked(sessionIds);
  const rememberAll = () => {
    for (const sid of sessionIds) rememberLocally(`${REVOKED_SESSION_KEY_PREFIX}${sid}`, ttlSeconds);
  };
  if (circuitIsOpen()) return rememberAll();
  try {
    const pipeline = client.pipeline();
    for (const sid of sessionIds) pipeline.set(`${REVOKED_SESSION_KEY_PREFIX}${sid}`, '1', 'EX', ttlSeconds);
    const results = await pipeline.exec();
    if (results?.some(([err]) => err)) throw results.find(([err]) => err)![0];
    recordSuccess();
  } catch (error) {
    recordFailure('revokeSessionIds', error);
    rememberAll();
  }
}

/** See the fail-open note on `client` above. */
export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  if (revokedLocally(`${REVOKED_SESSION_KEY_PREFIX}${sessionId}`)) return true;
  if (circuitIsOpen()) return false;
  try {
    const value = await client.get(`${REVOKED_SESSION_KEY_PREFIX}${sessionId}`);
    recordSuccess();
    return value === '1';
  } catch (error) {
    recordFailure('isSessionRevoked', error);
    return false;
  }
}
