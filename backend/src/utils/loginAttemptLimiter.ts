import { isOtpAttemptLocked, recordFailedOtpAttempt, clearOtpAttempts } from '@utils/otpAttemptLimiter';

// Per-account lockout for password checks (login, reactivate, suspension
// review), on top of the IP-keyed authLimiter — that one can't stop a
// password-spraying botnet rotating IPs against one account. Keyed on the
// normalized email whether or not an account exists, so a lockout response
// doesn't reveal which emails are registered. Same Redis counter (and the
// same fail-open behaviour) as the OTP limiter.

const LOGIN_ATTEMPT_TYPE = 'LOGIN_PASSWORD';
export const MAX_LOGIN_ATTEMPTS = 10;
export const LOGIN_LOCKOUT_MINUTES = 15;

export const LOGIN_LOCKED_MESSAGE =
  `Too many failed sign-in attempts. Try again in ${LOGIN_LOCKOUT_MINUTES} minutes, or reset your password.`;

export const isLoginLocked = (email: string): Promise<boolean> =>
  isOtpAttemptLocked(email, LOGIN_ATTEMPT_TYPE, MAX_LOGIN_ATTEMPTS);

/** Counts a failed password check; true if this failure just locked the account. */
export const recordFailedLogin = async (email: string): Promise<boolean> =>
  (await recordFailedOtpAttempt(email, LOGIN_ATTEMPT_TYPE, LOGIN_LOCKOUT_MINUTES * 60)) === MAX_LOGIN_ATTEMPTS;

export const clearFailedLogins = (email: string): Promise<void> => clearOtpAttempts(email, LOGIN_ATTEMPT_TYPE);
