import { randomUUID } from 'crypto';

// Point both modules at a port nothing listens on: this is a Redis outage.
process.env.REDIS_URL = 'redis://127.0.0.1:1';

import {
  isOtpAttemptLocked,
  recordFailedOtpAttempt,
  clearOtpAttempts,
  otpLockRemainingSeconds,
  MAX_OTP_ATTEMPTS,
  OTP_LOCKOUT_SECONDS,
} from '@utils/otpAttemptLimiter';
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

  it('locks for 10 minutes counted from the 5th wrong code', async () => {
    const userId = randomUUID();
    // A short window for the guesses themselves must not shorten the lockout.
    for (let i = 1; i <= MAX_OTP_ATTEMPTS; i++) await recordFailedOtpAttempt(userId, 'EMAIL_VERIFICATION', 30);

    expect(OTP_LOCKOUT_SECONDS).toBe(600);
    const remaining = await otpLockRemainingSeconds(userId, 'EMAIL_VERIFICATION');
    expect(remaining).toBeGreaterThan(590);
    expect(remaining).toBeLessThanOrEqual(600);
    // Not locked yet: nothing to wait for.
    expect(await otpLockRemainingSeconds(randomUUID(), 'EMAIL_VERIFICATION')).toBe(0);
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
