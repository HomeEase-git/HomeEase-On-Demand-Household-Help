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
  logout,
  mfaSetup,
  mfaVerifySetup,
  mfaChallenge,
  mfaDisable,
} from '@controllers/authController';
import { authMiddleware } from '@middleware/auth';
import { restrictTo } from '@middleware/role';
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
router.post('/refresh', authLimiter, refreshToken);

router.get('/me', authMiddleware, getMe);
router.post('/logout', authMiddleware, logout);

// MFA (TOTP) — mandatory for ADMIN, opt-in for CLIENT/WORKER (see
// mfaSetupRequired in authController.ts, which only force-nudges admins).
// setup/verify-setup/disable require an existing session; challenge is
// deliberately unauthenticated (the user isn't logged in yet — it's
// exchanging login's short-lived challengeToken for a real session) and
// carries the same strict limiter as every other credential endpoint above.
router.post('/mfa/setup', authMiddleware, restrictTo('ADMIN', 'CLIENT', 'WORKER'), mfaSetup);
router.post('/mfa/verify-setup', authMiddleware, restrictTo('ADMIN', 'CLIENT', 'WORKER'), mfaVerifySetup);
router.post('/mfa/challenge', authLimiter, mfaChallenge);
router.post('/mfa/disable', authMiddleware, restrictTo('ADMIN', 'CLIENT', 'WORKER'), authLimiter, mfaDisable);

export default router;
