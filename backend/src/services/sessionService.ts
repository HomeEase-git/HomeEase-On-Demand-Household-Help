import crypto from 'crypto';
import { TokenType } from '@prisma/client';
import prisma from '@config/database';
import { generateToken, JWT_EXPIRY } from '@utils/jwt';
import { storeRefreshToken } from '@utils/otpService';
import { revokeSessionIds } from '@utils/tokenRevocation';

/**
 * Per-device sessions. Each sign-in gets a session id that stays the same
 * across refresh-token rotation (AuthToken.sessionId) and rides in every
 * access token as `sid`, so one device can be signed out without touching
 * the others.
 */

export interface IssuedSession {
  token: string;
  refreshToken: string;
  sessionId: string;
}

// Admin sessions reach everything, so they're bounded more tightly than
// client/worker ones (OWASP ASVS 3.3): signed out after 30 minutes idle and
// 12 hours after sign-in however active. The admin site runs the idle timer;
// the server backs it up by making each admin refresh token expire if it
// isn't used within the idle window plus one access-token lifetime. Admin
// access tokens are capped at 15 minutes whatever JWT_EXPIRY says — the
// admin site always renews, unlike older mobile builds.
export const ADMIN_IDLE_TIMEOUT_MINUTES = 30;
export const ADMIN_SESSION_MAX_HOURS = 12;
const ADMIN_ACCESS_TOKEN_SECONDS = 15 * 60;
const ADMIN_REFRESH_WINDOW_MS = (ADMIN_IDLE_TIMEOUT_MINUTES * 60 + ADMIN_ACCESS_TOKEN_SECONDS) * 1000;

/** An admin session past its 12-hour limit can't be renewed. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session has reached its maximum length');
  }
}

/** When this device signed in: its oldest refresh token still on file. */
async function sessionStartedAt(sessionId: string): Promise<Date | null> {
  const { _min } = await prisma.authToken.aggregate({
    where: { type: TokenType.REFRESH, sessionId },
    _min: { createdAt: true },
  });
  return _min.createdAt;
}

/**
 * Access + refresh token for a sign-in (new device, no `sessionId`) or a
 * refresh (same device). Throws SessionExpiredError for an admin session past
 * ADMIN_SESSION_MAX_HOURS.
 */
export async function issueSession(
  user: { id: string; email: string; role: string },
  sessionId?: string
): Promise<IssuedSession> {
  const sid = sessionId ?? crypto.randomUUID();
  const refreshToken = crypto.randomBytes(40).toString('hex');

  if (user.role === 'ADMIN') {
    const now = Date.now();
    const startedAt = sessionId ? ((await sessionStartedAt(sessionId))?.getTime() ?? now) : now;
    const sessionEndsAt = startedAt + ADMIN_SESSION_MAX_HOURS * 60 * 60 * 1000;
    if (sessionEndsAt <= now) throw new SessionExpiredError();

    await storeRefreshToken(user.id, refreshToken, sid, new Date(Math.min(now + ADMIN_REFRESH_WINDOW_MS, sessionEndsAt)));
    const token = generateToken(
      { userId: user.id, email: user.email, role: user.role, sid },
      Math.min(JWT_EXPIRY, ADMIN_ACCESS_TOKEN_SECONDS),
    );
    return { token, refreshToken, sessionId: sid };
  }

  await storeRefreshToken(user.id, refreshToken, sid);
  const token = generateToken({ userId: user.id, email: user.email, role: user.role, sid });
  return { token, refreshToken, sessionId: sid };
}

/**
 * Signed-in devices: one per live session id. Refresh tokens from before
 * session ids existed each count as their own device.
 */
export async function countActiveSessions(userId: string): Promise<number> {
  const rows = await prisma.authToken.findMany({
    where: { userId, type: TokenType.REFRESH, expiresAt: { gt: new Date() } },
    select: { id: true, sessionId: true },
  });
  return new Set(rows.map((r) => r.sessionId ?? `legacy:${r.id}`)).size;
}

/**
 * Signs out every device except the current one: deletes their refresh
 * tokens (no new access tokens) and revokes their session ids (their current
 * access tokens stop working immediately — see middleware/auth.ts).
 * Returns how many devices were signed out.
 */
export async function revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  const others = await prisma.authToken.findMany({
    // sessionId null = a sign-in from before session ids; a plain `not`
    // would skip those (NULL never compares unequal in SQL).
    where: { userId, type: TokenType.REFRESH, OR: [{ sessionId: null }, { sessionId: { not: currentSessionId } }] },
    select: { id: true, sessionId: true },
  });
  if (others.length === 0) return 0;

  await prisma.authToken.deleteMany({ where: { id: { in: others.map((o) => o.id) } } });
  const sessionIds = Array.from(new Set(others.map((o) => o.sessionId).filter((s): s is string => !!s)));
  await revokeSessionIds(sessionIds, JWT_EXPIRY);
  return new Set(others.map((o) => o.sessionId ?? `legacy:${o.id}`)).size;
}

/**
 * Signs out one device: deletes its refresh tokens (including rotated ones)
 * and revokes its session id so its current access token stops working.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.authToken.deleteMany({ where: { type: TokenType.REFRESH, sessionId } });
  await revokeSessionIds([sessionId], JWT_EXPIRY);
}

/**
 * Signs out every device of an account (password reset). Unlike
 * tokenRevocation.revokeUserSessions — which blocks the whole account for a
 * token lifetime, right for bans — this still lets the user sign in again
 * straight away.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  const rows = await prisma.authToken.findMany({
    where: { userId, type: TokenType.REFRESH, sessionId: { not: null } },
    select: { sessionId: true },
  });
  await prisma.authToken.deleteMany({ where: { userId, type: TokenType.REFRESH } });
  const sessionIds = Array.from(new Set(rows.map((r) => r.sessionId).filter((s): s is string => !!s)));
  await revokeSessionIds(sessionIds, JWT_EXPIRY);
}
