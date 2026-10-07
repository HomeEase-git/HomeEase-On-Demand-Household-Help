import { randomUUID } from 'crypto';

// Point both modules at a port nothing listens on: this is a Redis outage.
process.env.REDIS_URL = 'redis://127.0.0.1:1';

import { isOtpAttemptLocked, recordFailedOtpAttempt, clearOtpAttempts, MAX_OTP_ATTEMPTS } from '@utils/otpAttemptLimiter';
import { revokeUserSessions, isUserSessionRevoked, clearUserSessionRevocation, revokeSessionIds, isSessionRevoked } from '@utils/tokenRevocation';

jest.setTimeout(60_000);

describe('with Redis down', () => {
  it('still locks an account after too many wrong codes', async () => {
    const userId = randomUUID();
    for (let i = 1; i <= MAX_OTP_ATTEMPTS; i++) {
      expect(await isOtpAttemptLocked(userId, 'LOGIN_2FA')).toBe(false);
      expect(await recordFailedOtpAttempt(userId, 'LOGIN_2FA', 600)).toBe(i);
    }
    expect(await isOtpAttemptLocked(userId, 'LOGIN_2FA')).toBe(true);
    expect(await isOtpAttemptLocked(userId, 'PASSWORD_RESET')).toBe(false);

    await clearOtpAttempts(userId, 'LOGIN_2FA');
    expect(await isOtpAttemptLocked(userId, 'LOGIN_2FA')).toBe(false);
  });

  it('still refuses revoked sessions', async () => {
    const userId = randomUUID();
    const sid = randomUUID();
    await revokeUserSessions(userId, 900);
    await revokeSessionIds([sid], 900);
    expect(await isUserSessionRevoked(userId)).toBe(true);
    expect(await isSessionRevoked(sid)).toBe(true);
    expect(await isSessionRevoked(randomUUID())).toBe(false);

    await clearUserSessionRevocation(userId);
    expect(await isUserSessionRevoked(userId)).toBe(false);
  });
});
