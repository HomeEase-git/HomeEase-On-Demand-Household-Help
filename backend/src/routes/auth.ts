import { Router } from 'express';
import {
  signup,
  login,
  getMe,
  sendOtp,
  verifyOtpHandler,
  resendOtp,
  forgotPassword,
  resetPassword,
  refreshToken,
  requestSuspensionReview,
  logout,
  mfaSetup,
  mfaVerifySetup,
  mfaChallenge,
  mfaDisable,
  verifyLoginCode,
  resendLoginCode,
  sendTwoFactorCode,
  enableTwoFactor,
  disableTwoFactor,
  reactivateAccount,
} from '@controllers/authController';
import { authMiddleware } from '@middleware/auth';
import { restrictTo, restrictToAdminSettingUpMfa } from '@middleware/role';
import { authLimiter } from '@middleware/rateLimit';

const router = Router();

// Unauthenticated credential endpoints — brute-force / enumeration targets,
// so each carries the strict per-IP limiter.
router.post('/signup', authLimiter, signup);
router.post('/login', authLimiter, login);
router.post('/send-otp', authLimiter, sendOtp);
router.post('/verify-otp', authLimiter, verifyOtpHandler);
router.post('/resend-otp', authLimiter, resendOtp);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
// NOT behind authLimiter: a refresh token is 40 random bytes, so there is
// nothing to guess, but a 401 here (rotated token, expiry, app relaunch) is
// routine and used to spend the shared per-IP credential budget — which then
// 429'd /auth/login for every account on that IP. The global apiLimiter
// (300/min per IP, app.ts) still covers it.
router.post('/refresh', refreshToken);
router.post('/suspension-review', authLimiter, requestSuspensionReview);
router.post('/reactivate', authLimiter, reactivateAccount);

router.get('/me', authMiddleware, getMe);
router.post('/logout', authMiddleware, logout);

// MFA (TOTP authenticator app) — mandatory for ADMIN. Clients and workers use
// email/SMS codes instead (/2fa below); a few older client/worker accounts
// that set up an authenticator can still sign in with it and turn it off.
// setup/verify-setup/disable require an existing session; challenge is
// deliberately unauthenticated (the user isn't logged in yet — it's
// exchanging login's short-lived challengeToken for a real session) and
// carries the same strict limiter as every other credential endpoint above.
router.post('/mfa/setup', authMiddleware, restrictToAdminSettingUpMfa(), mfaSetup);
router.post('/mfa/verify-setup', authMiddleware, restrictToAdminSettingUpMfa(), mfaVerifySetup);
router.post('/mfa/challenge', authLimiter, mfaChallenge);
router.post('/mfa/disable', authMiddleware, restrictTo('ADMIN', 'CLIENT', 'WORKER'), authLimiter, mfaDisable);

// Two-step sign-in by email/SMS code (clients and workers). verify/resend
// finish a login (unauthenticated, strict limiter); code/enable/disable
// manage the setting from a signed-in session.
router.post('/2fa/verify', authLimiter, verifyLoginCode);
router.post('/2fa/resend', authLimiter, resendLoginCode);
router.post('/2fa/code', authMiddleware, restrictTo('CLIENT', 'WORKER'), authLimiter, sendTwoFactorCode);
router.post('/2fa/enable', authMiddleware, restrictTo('CLIENT', 'WORKER'), authLimiter, enableTwoFactor);
router.post('/2fa/disable', authMiddleware, restrictTo('CLIENT', 'WORKER'), authLimiter, disableTwoFactor);

export default router;
