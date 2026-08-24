import { Request, Response } from 'express';
import prisma from '@config/database';
import { TokenType } from '@prisma/client';
import { hashPassword, comparePassword } from '@utils/passwordHash';
import { generateToken } from '@utils/jwt';
import { validateEmail, validatePassword, validatePhone, validateOtp } from '@utils/validators';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import {
  sendOtpEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from '@utils/emailService';
import {
  generateOtp,
  storeOtp,
  verifyOtp,
  storeRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
} from '@utils/otpService';
import crypto from 'crypto';

type SignupRole = 'CLIENT' | 'WORKER';

const getTrimmedString = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const getPasswordString = (value: unknown): string => {
  return typeof value === 'string' ? value : '';
};

const normalizeEmail = (value: unknown): string => {
  return getTrimmedString(value).toLowerCase();
};

const normalizeSignupRole = (value: unknown): SignupRole | null => {
  const role = getTrimmedString(value).toUpperCase();
  if (role === 'CLIENT' || role === 'WORKER') return role;
  return null;
};

// ============================================================================
// SIGNUP
// ============================================================================

export const signup = async (req: Request, res: Response) => {
  try {
    const fullName = getTrimmedString(req.body.fullName);
    const email = normalizeEmail(req.body.email);
    const phone = getTrimmedString(req.body.phone);
    const password = getPasswordString(req.body.password);
    const role = normalizeSignupRole(req.body.role);

    if (!fullName || !email || !phone || !password || !req.body.role) {
      return res.status(400).json(errorResponse(400, 'Missing required fields'));
    }

    if (!role) {
      return res.status(400).json(errorResponse(400, 'Role must be either CLIENT or WORKER'));
    }

    if (!validateEmail(email)) {
      return res.status(400).json(errorResponse(400, 'Invalid email format'));
    }

    if (!validatePassword(password)) {
      return res.status(400).json(
        errorResponse(400, 'Password must be at least 8 characters with 1 uppercase letter and 1 number')
      );
    }

    if (!validatePhone(phone)) {
      return res.status(400).json(errorResponse(400, 'Invalid phone number'));
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      return res.status(409).json(errorResponse(409, 'Email already registered'));
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { fullName, email, phone, password: hashedPassword, role },
      });

      if (role === 'WORKER') {
        await tx.workerProfile.create({ data: { userId: createdUser.id } });
      } else {
        await tx.clientProfile.create({ data: { userId: createdUser.id } });
      }

      return createdUser;
    });

    // Generate and send OTP — the account is already created at this point,
    // so a failed email send shouldn't turn a successful signup into a 500.
    const otp = generateOtp();
    await storeOtp(user.id, otp);
    try {
      await sendOtpEmail(email, otp);
    } catch (emailError) {
      console.error('Failed to send OTP email during signup:', emailError);
    }

    const token = generateToken({ userId: user.id, email: user.email, role: user.role });
    const refreshToken = crypto.randomBytes(40).toString('hex');
    await storeRefreshToken(user.id, refreshToken);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully. Please verify your email.',
      data: {
        id: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        // New worker accounts always start unverified — surfaced so the
        // mobile app can route into the KYC flow instead of the worker tabs.
        kycStatus: user.role === 'WORKER' ? 'PENDING' : undefined,
        // Gates the client-agreement screen — a brand-new account can't have
        // accepted anything yet.
        hasAcceptedTerms: user.role === 'CLIENT' ? false : undefined,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

// ============================================================================
// LOGIN
// ============================================================================

export const login = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = getPasswordString(req.body.password);

    if (!email || !password) {
      return res.status(400).json(errorResponse(400, 'Email and password required'));
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { workerProfile: { select: { kycStatus: true } } },
    });

    if (!user) {
      await writeAuditLog({
        action: 'USER_LOGIN_FAILED',
        category: 'LOGIN',
        level: 'WARN',
        message: `Login failed for ${email}: no account found`,
      });
      return res.status(401).json(errorResponse(401, 'Invalid credentials'));
    }

    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      await writeAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: 'USER_LOGIN_FAILED',
        category: 'LOGIN',
        level: 'WARN',
        message: `Login failed for ${email}: incorrect password`,
      });
      return res.status(401).json(errorResponse(401, 'Invalid credentials'));
    }

    if (user.status !== 'ACTIVE') {
      const message =
        user.status === 'SUSPENDED'
          ? 'This account has been suspended. Contact support for assistance.'
          : user.status === 'BANNED'
            ? 'This account has been banned.'
            : 'This account no longer exists.';
      return res.status(403).json(errorResponse(403, message));
    }

    const token = generateToken({ userId: user.id, email: user.email, role: user.role });
    const refreshToken = crypto.randomBytes(40).toString('hex');
    await storeRefreshToken(user.id, refreshToken);

    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'USER_LOGIN_SUCCESS',
      category: 'LOGIN',
      message: `${user.fullName} logged in`,
    });

    // Gates the client-agreement screen — undefined for workers, who have
    // their own contract flow tied to KYC instead.
    const hasAcceptedTerms =
      user.role === 'CLIENT'
        ? Boolean(
            await prisma.contractAcceptance.findFirst({
              where: { userId: user.id, contractType: 'CLIENT_USER_AGREEMENT' },
              select: { id: true },
            }),
          )
        : undefined;

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        id: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        // Lets the app gate worker access until admin approval — client
        // accounts don't have a workerProfile so this stays undefined.
        kycStatus: user.role === 'WORKER' ? (user.workerProfile?.kycStatus ?? 'PENDING') : undefined,
        hasAcceptedTerms,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

// ============================================================================
// GET /api/auth/me
// ============================================================================

export const getMe = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { workerProfile: { select: { kycStatus: true } } },
    });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    return res.json({
      success: true,
      data: {
        id: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        kycStatus: user.role === 'WORKER' ? (user.workerProfile?.kycStatus ?? 'PENDING') : undefined,
      },
    });
  } catch (error) {
    console.error('Get me error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

// ============================================================================
// OTP
// ============================================================================

export const sendOtp = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!validateEmail(email)) {
      return res.status(400).json(errorResponse(400, 'Invalid email'));
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    if (user.isVerified) {
      return res.status(400).json(errorResponse(400, 'Email already verified'));
    }

    const otp = generateOtp();
    await storeOtp(user.id, otp);
    await sendOtpEmail(email, otp);

    return res.json({ success: true, message: 'OTP sent to your email' });
  } catch (error) {
    console.error('Send OTP error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const verifyOtpHandler = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = getTrimmedString(req.body.otp);

    if (!validateEmail(email)) {
      return res.status(400).json(errorResponse(400, 'Invalid email'));
    }

    if (!validateOtp(otp)) {
      return res.status(400).json(errorResponse(400, 'OTP must be 6 digits'));
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    if (user.isVerified) {
      return res.status(400).json(errorResponse(400, 'Email already verified'));
    }

    const isValid = await verifyOtp(user.id, otp);

    if (!isValid) {
      return res.status(400).json(errorResponse(400, 'Invalid or expired OTP'));
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });

    // Verification already succeeded — a failed welcome email shouldn't undo that.
    try {
      await sendWelcomeEmail(email, user.fullName);
    } catch (emailError) {
      console.error('Failed to send welcome email after OTP verification:', emailError);
    }

    const token = generateToken({ userId: user.id, email: user.email, role: user.role });

    return res.json({
      success: true,
      message: 'Email verified successfully',
      data: { token },
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const resendOtp = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!validateEmail(email)) {
      return res.status(400).json(errorResponse(400, 'Invalid email'));
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    if (user.isVerified) {
      return res.status(400).json(errorResponse(400, 'Email already verified'));
    }

    const otp = generateOtp();
    await storeOtp(user.id, otp);
    await sendOtpEmail(email, otp);

    return res.json({ success: true, message: 'OTP resent to your email' });
  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

// ============================================================================
// PASSWORD RESET
// ============================================================================

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!validateEmail(email)) {
      return res.status(400).json(errorResponse(400, 'Invalid email'));
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Always return success for security — do not reveal if email exists
    if (!user) {
      return res.json({
        success: true,
        message: 'If that email is registered, a reset link has been sent',
      });
    }

    const otp = generateOtp();
    await storeOtp(user.id, otp, TokenType.PASSWORD_RESET);

    // Must not let a failed send produce a different response than the
    // "email not registered" path above — that would leak account existence.
    try {
      await sendPasswordResetEmail(email, otp);
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError);
    }

    return res.json({
      success: true,
      message: 'If that email is registered, a reset code has been sent',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = getTrimmedString(req.body.otp);
    const newPassword = getPasswordString(req.body.newPassword);

    if (!validateEmail(email)) {
      return res.status(400).json(errorResponse(400, 'Invalid email'));
    }

    if (!validateOtp(otp)) {
      return res.status(400).json(errorResponse(400, 'OTP must be 6 digits'));
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json(
        errorResponse(400, 'Password must be at least 8 characters with 1 uppercase letter and 1 number')
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(400).json(errorResponse(400, 'Invalid or expired OTP'));
    }

    const isValid = await verifyOtp(user.id, otp, TokenType.PASSWORD_RESET);

    if (!isValid) {
      return res.status(400).json(errorResponse(400, 'Invalid or expired OTP'));
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // Revoke all refresh tokens on password reset for security
    await revokeAllRefreshTokens(user.id);

    return res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

// ============================================================================
// REFRESH TOKEN
// ============================================================================

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const token = getTrimmedString(req.body.refreshToken);

    if (!token) {
      return res.status(400).json(errorResponse(400, 'Refresh token required'));
    }

    const userId = await verifyRefreshToken(token);

    if (!userId) {
      return res.status(401).json(errorResponse(401, 'Invalid or expired refresh token'));
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(401).json(errorResponse(401, 'User not found'));
    }

    // Rotate refresh token
    await revokeRefreshToken(token);
    const newRefreshToken = crypto.randomBytes(40).toString('hex');
    await storeRefreshToken(user.id, newRefreshToken);

    const newToken = generateToken({ userId: user.id, email: user.email, role: user.role });

    return res.json({
      success: true,
      message: 'Token refreshed',
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

// ============================================================================
// LOGOUT
// ============================================================================

export const logout = async (req: Request, res: Response) => {
  try {
    const token = getTrimmedString(req.body.refreshToken);
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json(errorResponse(401, 'Unauthorized'));
    }

    if (token) {
      await revokeRefreshToken(token);
    } else {
      await revokeAllRefreshTokens(userId);
    }

    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};