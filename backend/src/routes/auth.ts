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

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', authMiddleware, getMe);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtpHandler);
router.post('/resend-otp', resendOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/refresh', refreshToken);
router.post('/logout', authMiddleware, logout);

export default router;