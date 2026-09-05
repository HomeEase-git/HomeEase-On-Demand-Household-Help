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
} from '@controllers/authController';
import { authMiddleware } from '@middleware/auth';
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

export default router;
