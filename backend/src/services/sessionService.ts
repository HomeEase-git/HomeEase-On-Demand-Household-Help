import crypto from 'crypto';
import { TokenType } from '@prisma/client';
import prisma from '@config/database';
import { generateToken, JWT_EXPIRY } from '@utils/jwt';
import { storeRefreshToken } from '@utils/otpService';
import { revokeSessionIds } from '@utils/tokenRevocation';

export interface IssuedSession {
  token: string;
  refreshToken: string;
  sessionId: string;
}

export const ADMIN_IDLE_TIMEOUT_MINUTES = 30;
export const ADMIN_SESSION_MAX_HOURS = 12;
const ADMIN_ACCESS_TOKEN_SECONDS = 15 * 60;
const ADMIN_REFRESH_WINDOW_MS = (ADMIN_IDLE_TIMEOUT_MINUTES * 60 + ADMIN_ACCESS_TOKEN_SECONDS) * 1000;

export class SessionExpiredError extends Error {
  constructor() {
    super('Session has reached its maximum length');
  }
}

async function sessionStartedAt(sessionId: string): Promise<Date | null> {
  const { _min } = await prisma.authToken.aggregate({
    where: { type: TokenType.REFRESH, sessionId },
    _min: { createdAt: true },
  });
  return _min.createdAt;
}

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

export async function countActiveSessions(userId: string): Promise<number> {
  const rows = await prisma.authToken.findMany({
    where: { userId, type: TokenType.REFRESH, expiresAt: { gt: new Date() } },
    select: { id: true, sessionId: true },
  });
  return new Set(rows.map((r) => r.sessionId ?? `legacy:${r.id}`)).size;
}

export async function revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  const others = await prisma.authToken.findMany({
    where: { userId, type: TokenType.REFRESH, OR: [{ sessionId: null }, { sessionId: { not: currentSessionId } }] },
    select: { id: true, sessionId: true },
  });
  if (others.length === 0) return 0;

  await prisma.authToken.deleteMany({ where: { id: { in: others.map((o) => o.id) } } });
  const sessionIds = Array.from(new Set(others.map((o) => o.sessionId).filter((s): s is string => !!s)));
  await revokeSessionIds(sessionIds, JWT_EXPIRY);
  return new Set(others.map((o) => o.sessionId ?? `legacy:${o.id}`)).size;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.authToken.deleteMany({ where: { type: TokenType.REFRESH, sessionId } });
  await revokeSessionIds([sessionId], JWT_EXPIRY);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  const rows = await prisma.authToken.findMany({
    where: { userId, type: TokenType.REFRESH, sessionId: { not: null } },
    select: { sessionId: true },
  });
  await prisma.authToken.deleteMany({ where: { userId, type: TokenType.REFRESH } });
  const sessionIds = Array.from(new Set(rows.map((r) => r.sessionId).filter((s): s is string => !!s)));
  await revokeSessionIds(sessionIds, JWT_EXPIRY);
}
