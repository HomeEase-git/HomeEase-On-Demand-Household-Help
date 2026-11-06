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

router.post('/signup', authLimiter, signup);
router.post('/login', authLimiter, login);
router.post('/send-otp', authLimiter, sendOtp);
router.post('/verify-otp', authLimiter, verifyOtpHandler);
router.post('/resend-otp', authLimiter, resendOtp);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/refresh', refreshToken);
router.post('/suspension-review', authLimiter, requestSuspensionReview);
router.post('/reactivate', authLimiter, reactivateAccount);

router.get('/me', authMiddleware, getMe);
router.post('/logout', authMiddleware, logout);

router.post('/mfa/setup', authMiddleware, restrictToAdminSettingUpMfa(), mfaSetup);
router.post('/mfa/verify-setup', authMiddleware, restrictToAdminSettingUpMfa(), mfaVerifySetup);
router.post('/mfa/challenge', authLimiter, mfaChallenge);
router.post('/mfa/disable', authMiddleware, restrictTo('ADMIN', 'CLIENT', 'WORKER'), authLimiter, mfaDisable);

router.post('/2fa/verify', authLimiter, verifyLoginCode);
router.post('/2fa/resend', authLimiter, resendLoginCode);
router.post('/2fa/code', authMiddleware, restrictTo('CLIENT', 'WORKER'), authLimiter, sendTwoFactorCode);
router.post('/2fa/enable', authMiddleware, restrictTo('CLIENT', 'WORKER'), authLimiter, enableTwoFactor);
router.post('/2fa/disable', authMiddleware, restrictTo('CLIENT', 'WORKER'), authLimiter, disableTwoFactor);

export default router;
