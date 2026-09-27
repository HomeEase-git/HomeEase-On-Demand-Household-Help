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

/** Access + refresh token for a sign-in (new device) or a refresh (same device). */
export async function issueSession(
  user: { id: string; email: string; role: string },
  sessionId: string = crypto.randomUUID()
): Promise<IssuedSession> {
  const refreshToken = crypto.randomBytes(40).toString('hex');
  await storeRefreshToken(user.id, refreshToken, sessionId);
  const token = generateToken({ userId: user.id, email: user.email, role: user.role, sid: sessionId });
  return { token, refreshToken, sessionId };
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
