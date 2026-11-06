import { isOtpAttemptLocked, recordFailedOtpAttempt, clearOtpAttempts } from '@utils/otpAttemptLimiter';

const LOGIN_ATTEMPT_TYPE = 'LOGIN_PASSWORD';
export const MAX_LOGIN_ATTEMPTS = 10;
export const LOGIN_LOCKOUT_MINUTES = 15;

export const LOGIN_LOCKED_MESSAGE =
  `Too many failed sign-in attempts. Try again in ${LOGIN_LOCKOUT_MINUTES} minutes, or reset your password.`;

export const isLoginLocked = (email: string): Promise<boolean> =>
  isOtpAttemptLocked(email, LOGIN_ATTEMPT_TYPE, MAX_LOGIN_ATTEMPTS);

export const recordFailedLogin = async (email: string): Promise<boolean> =>
  (await recordFailedOtpAttempt(email, LOGIN_ATTEMPT_TYPE, LOGIN_LOCKOUT_MINUTES * 60)) === MAX_LOGIN_ATTEMPTS;

export const clearFailedLogins = (email: string): Promise<void> => clearOtpAttempts(email, LOGIN_ATTEMPT_TYPE);
