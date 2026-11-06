import { Request, Response } from 'express';
import prisma from '@config/database';
import { TokenType, type Role, type TwoFactorMethod } from '@prisma/client';
import { hashPassword, comparePassword } from '@utils/passwordHash';
import { generateToken, verifyToken } from '@utils/jwt';
import { validateEmail, validatePhone, validateOtp } from '@utils/validators';
import { checkNewPassword, containsPersonalInfo, PERSONAL_INFO_PASSWORD_MESSAGE } from '@utils/passwordPolicy';
import {
  isLoginLocked,
  recordFailedLogin,
  clearFailedLogins,
  LOGIN_LOCKED_MESSAGE,
  LOGIN_LOCKOUT_MINUTES,
  MAX_LOGIN_ATTEMPTS,
} from '@utils/loginAttemptLimiter';
import { notifyAccountSecurityEvent, raiseSecurityAlert, recordPasswordChange } from '@services/securityAlertService';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import {
  sendOtpEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from '@utils/emailService';
import {
  generateOtp,
  storeOtp,
  verifyOtp,
  respondIfOtpLocked,
  OtpLockedError,
  consumeRefreshToken,
  revokeRefreshToken,
} from '@utils/otpService';
import {
  generateMfaSecret,
  buildProvisioningUri,
  generateQrCodeDataUrl,
  totpStep,
  encryptMfaSecret,
  decryptMfaSecret,
  generateBackupCodes,
  verifyMfaCode,
} from '@utils/mfaService';
import { sendOtpSms } from '@utils/smsService';
import { parseWorkerBirthDate } from '@utils/age';
import { clearUserSessionRevocation } from '@utils/tokenRevocation';
import { getAppSettings } from '@services/appSettingsService';
import { issueSession, revokeSession, revokeAllSessions, SessionExpiredError } from '@services/sessionService';
import type { JwtPayload } from '../types';

const MFA_CHALLENGE_TOKEN_TTL_SECONDS = 5 * 60;

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

let dummyPasswordHash: Promise<string> | null = null;

const failPasswordCheck = async (
  email: string,
  user: { id: string; email: string; role: string; fullName: string } | null,
): Promise<void> => {
  if (!(await recordFailedLogin(email))) return;
  const isAdmin = user?.role === 'ADMIN';
  const who = isAdmin ? 'Admin account' : user ? 'Account' : 'Unregistered email';
  await raiseSecurityAlert({
    type: 'LOGIN_LOCKOUT',
    severity: isAdmin ? 'high' : 'medium',
    message: `${who} ${email.slice(0, 254)} was locked after ${MAX_LOGIN_ATTEMPTS} wrong passwords within ${LOGIN_LOCKOUT_MINUTES} minutes.`,
    actor: user ? { id: user.id, email: user.email, role: user.role, name: user.fullName } : { email: email.slice(0, 254) },
    throttleKey: isAdmin ? email : 'non-admin',
  });
};

const passwordMatches = async (user: { password: string } | null, password: string): Promise<boolean> => {
  if (!user) {
    dummyPasswordHash ??= hashPassword('homeease-timing-equaliser');
    await comparePassword(password, await dummyPasswordHash);
    return false;
  }
  return comparePassword(password, user.password);
};

const normalizeSignupRole = (value: unknown): SignupRole | null => {
  const role = getTrimmedString(value).toUpperCase();
  if (role === 'CLIENT' || role === 'WORKER') return role;
  return null;
};

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

    const passwordError = await checkNewPassword(password, { fullName, email, phone });
    if (passwordError) {
      return res.status(400).json(errorResponse(400, passwordError));
    }

    if (!validatePhone(phone)) {
      return res.status(400).json(errorResponse(400, 'Invalid phone number'));
    }

    let workerBirthDate: Date | null = null;
    if (role === 'WORKER') {
      const parsed = parseWorkerBirthDate(req.body.birthDate, await getAppSettings());
      if ('error' in parsed) {
        return res.status(400).json(errorResponse(400, parsed.error));
      }
      workerBirthDate = parsed.date;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      return res.status(409).json(errorResponse(409, 'Email already registered'));
    }

    const bannedPhoneMatch = await prisma.user.findFirst({
      where: { phone, status: 'BANNED' },
      select: { id: true, fullName: true },
    });
    if (bannedPhoneMatch) {
      await writeAuditLog({
        action: 'SIGNUP_PHONE_MATCHES_BANNED_USER',
        category: 'LOGIN',
        level: 'WARN',
        message: `New signup (${email}) shares a phone number with banned user ${bannedPhoneMatch.fullName} (${bannedPhoneMatch.id}) — possible ban evasion.`,
        metadata: { newSignupEmail: email, bannedUserId: bannedPhoneMatch.id },
      });
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { fullName, email, phone, password: hashedPassword, role },
      });

      if (role === 'WORKER') {
        await tx.workerProfile.create({ data: { userId: createdUser.id, birthDate: workerBirthDate } });
      } else {
        await tx.clientProfile.create({ data: { userId: createdUser.id } });
      }

      const privacyNoticeVersion = getTrimmedString(req.body.privacyNoticeVersion);
      if (privacyNoticeVersion && /^[\w.-]{1,32}$/.test(privacyNoticeVersion)) {
        await tx.contractAcceptance.create({
          data: {
            userId: createdUser.id,
            contractType: 'PRIVACY_NOTICE',
            contractVersion: privacyNoticeVersion,
            ipAddress: req.ip ?? null,
            userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
          },
        });
      }

      return createdUser;
    });

    const otp = generateOtp();
    await storeOtp(user.id, otp);
    try {
      await sendOtpEmail(email, otp);
    } catch (emailError) {
      console.error('Failed to send OTP email during signup:', emailError);
    }

    const { token, refreshToken } = await issueSession(user);

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
        kycStatus: user.role === 'WORKER' ? 'PENDING' : undefined,
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

export const login = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = getPasswordString(req.body.password);

    if (!email || !password) {
      return res.status(400).json(errorResponse(400, 'Email and password required'));
    }

    if (await isLoginLocked(email)) {
      return res.status(429).json(errorResponse(429, LOGIN_LOCKED_MESSAGE));
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { workerProfile: { select: { kycStatus: true } } },
    });

    if (!user) {
      await passwordMatches(null, password);
      await failPasswordCheck(email, null);
      await writeAuditLog({
        action: 'USER_LOGIN_FAILED',
        category: 'LOGIN',
        level: 'WARN',
        message: `Login failed for ${email}: no account found`,
      });
      return res.status(401).json(errorResponse(401, 'Invalid credentials'));
    }

    const isPasswordValid = await passwordMatches(user, password);

    if (!isPasswordValid) {
      await failPasswordCheck(email, user);
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

    await clearFailedLogins(email);

    if (user.status === 'DEACTIVATED') {
      return res.status(403).json({
        ...errorResponse(403, 'This account is deactivated. Reactivate it to sign in.'),
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    if (user.status !== 'ACTIVE') {
      const message =
        user.status === 'SUSPENDED'
          ? 'This account has been suspended. Contact support for assistance.'
          : user.status === 'BANNED'
            ? 'This account has been banned.'
            : 'This account no longer exists.';
      const code = user.status === 'SUSPENDED' || user.status === 'BANNED' ? `ACCOUNT_${user.status}` : undefined;
      return res.status(403).json({ ...errorResponse(403, message), ...(code ? { code } : {}) });
    }

    if (user.role !== 'ADMIN' && !user.isVerified) {
      const otp = generateOtp();
      await storeOtp(user.id, otp);
      try {
        await sendOtpEmail(user.email, otp);
      } catch (emailError) {
        console.error('Failed to send OTP email at login:', emailError);
      }
      return res.status(403).json({
        ...errorResponse(403, 'Please verify your email. We sent you a new code.'),
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    if (user.mfaEnabled) {
      const challengeToken = generateToken(
        { userId: user.id, email: user.email, role: user.role, type: 'mfa_pending' },
        MFA_CHALLENGE_TOKEN_TTL_SECONDS,
      );

      return res.json({
        success: true,
        message: 'MFA verification required',
        data: { mfaRequired: true, challengeToken },
      });
    }

    if (user.role !== 'ADMIN' && user.twoFactorMethod) {
      const sent = await deliverCode(user, user.twoFactorMethod, TokenType.LOGIN_2FA);
      const challengeToken = generateToken(
        { userId: user.id, email: user.email, role: user.role, type: 'otp_pending' },
        OTP_CHALLENGE_TOKEN_TTL_SECONDS,
      );
      return res.json({
        success: true,
        message: 'Enter the code we sent you',
        data: { twoFactorRequired: true, challengeToken, method: sent.method, destination: sent.destination },
      });
    }

    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'USER_LOGIN_SUCCESS',
      category: 'LOGIN',
      message: `${user.fullName} logged in`,
    });

    return res.json({ success: true, message: 'Login successful', data: await loginPayload(user) });
  } catch (error) {
    if (respondIfOtpLocked(res, error)) return;
    console.error('Login error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const mfaSetup = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    if (user.mfaEnabled) {
      return res.status(400).json(errorResponse(400, 'MFA is already enabled on this account'));
    }

    const secret = generateMfaSecret();
    const provisioningUri = buildProvisioningUri(user.email, secret);
    const qrCodeDataUrl = await generateQrCodeDataUrl(provisioningUri);

    await prisma.mfaSecret.upsert({
      where: { userId: user.id },
      update: { secretEncrypted: encryptMfaSecret(secret), pending: true, confirmedAt: null },
      create: { userId: user.id, secretEncrypted: encryptMfaSecret(secret), pending: true },
    });

    return res.json({
      success: true,
      message: 'Scan the QR code with an authenticator app, then confirm with a 6-digit code.',
      data: { provisioningUri, qrCodeDataUrl, secret },
    });
  } catch (error) {
    console.error('MFA setup error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const mfaVerifySetup = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const code = getTrimmedString(req.body.code);

    if (!validateOtp(code)) {
      return res.status(400).json(errorResponse(400, 'Code must be 6 digits'));
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    if (user.mfaEnabled) {
      return res.status(400).json(errorResponse(400, 'MFA is already enabled on this account'));
    }

    const pendingSecret = await prisma.mfaSecret.findUnique({ where: { userId: user.id } });

    if (!pendingSecret || !pendingSecret.pending) {
      return res.status(400).json(errorResponse(400, 'No pending MFA setup found. Start setup again.'));
    }

    const secret = decryptMfaSecret(pendingSecret.secretEncrypted);

    const step = totpStep(secret, code);
    if (step === null) {
      return res.status(400).json(errorResponse(400, 'Invalid code. Please try again.'));
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((backupCode) => hashPassword(backupCode)));

    await prisma.$transaction(async (tx) => {
      await tx.mfaSecret.update({
        where: { userId: user.id },
        data: { pending: false, confirmedAt: new Date(), lastTotpStep: step },
      });
      await tx.mfaBackupCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaBackupCode.createMany({
        data: hashedCodes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    });

    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'MFA_ENABLED',
      category: 'LOGIN',
      message: `${user.fullName} enabled MFA`,
    });

    return res.json({
      success: true,
      message: 'MFA enabled. Save these backup codes now — they will not be shown again.',
      data: { backupCodes },
    });
  } catch (error) {
    console.error('MFA verify-setup error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const mfaChallenge = async (req: Request, res: Response) => {
  try {
    const challengeToken = getTrimmedString(req.body.challengeToken);
    const code = getTrimmedString(req.body.code);

    if (!challengeToken || !code) {
      return res.status(400).json(errorResponse(400, 'Challenge token and code are required'));
    }

    let payload: JwtPayload;
    try {
      payload = verifyToken(challengeToken);
    } catch {
      return res.status(401).json(errorResponse(401, 'Invalid or expired MFA challenge'));
    }

    if (payload.type !== 'mfa_pending') {
      return res.status(401).json(errorResponse(401, 'Invalid or expired MFA challenge'));
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { workerProfile: { select: { kycStatus: true } } },
    });

    if (!user || !user.mfaEnabled) {
      return res.status(401).json(errorResponse(401, 'Invalid or expired MFA challenge'));
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json(errorResponse(403, 'This account is not active'));
    }

    const verified = await verifyMfaCode(user.id, code);

    if (!verified) {
      await writeAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: 'MFA_CHALLENGE_FAILED',
        category: 'LOGIN',
        level: 'WARN',
        message: `MFA challenge failed for ${user.email}`,
      });
      return res.status(401).json(errorResponse(401, 'Invalid MFA code'));
    }

    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'MFA_CHALLENGE_SUCCESS',
      category: 'LOGIN',
      message: `${user.fullName} completed MFA challenge`,
    });
    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'USER_LOGIN_SUCCESS',
      category: 'LOGIN',
      message: `${user.fullName} logged in`,
    });

    // Same shape login() returns on the non-MFA path.
    return res.json({ success: true, message: 'Login successful', data: await loginPayload(user) });
  } catch (error) {
    console.error('MFA challenge error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const mfaDisable = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const password = getPasswordString(req.body.password);
    const code = getTrimmedString(req.body.code);

    if (!password || !code) {
      return res.status(400).json(errorResponse(400, 'Password and MFA code are required'));
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });

    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }

    if (!user.mfaEnabled) {
      return res.status(400).json(errorResponse(400, 'MFA is not enabled on this account'));
    }

    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      await writeAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: 'MFA_CHALLENGE_FAILED',
        category: 'LOGIN',
        level: 'WARN',
        message: `MFA disable rejected for ${user.email}: incorrect password`,
      });
      return res.status(401).json(errorResponse(401, 'Incorrect password'));
    }

    const verified = await verifyMfaCode(user.id, code);

    if (!verified) {
      await writeAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: 'MFA_CHALLENGE_FAILED',
        category: 'LOGIN',
        level: 'WARN',
        message: `MFA disable rejected for ${user.email}: invalid code`,
      });
      return res.status(401).json(errorResponse(401, 'Invalid MFA code'));
    }

    await prisma.$transaction(async (tx) => {
      await tx.mfaSecret.deleteMany({ where: { userId: user.id } });
      await tx.mfaBackupCode.deleteMany({ where: { userId: user.id } });
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false } });
    });

    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'MFA_DISABLED',
      category: 'LOGIN',
      level: 'WARN',
      message: `${user.fullName} disabled MFA`,
    });
    if (user.role === 'ADMIN') {
      await raiseSecurityAlert({
        type: 'ADMIN_MFA_DISABLED',
        severity: 'high',
        message: `Admin ${user.email} turned off two-step sign-in. They'll be asked to set it up again at next sign-in; if they didn't do this, their password and session are compromised.`,
        actor: { id: user.id, email: user.email, role: user.role, name: user.fullName },
        throttleKey: user.id,
      });
    }

    return res.json({ success: true, message: 'MFA disabled' });
  } catch (error) {
    console.error('MFA disable error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

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
        mfaEnabled: user.mfaEnabled,
        twoFactorMethod: user.twoFactorMethod,
      },
    });
  } catch (error) {
    console.error('Get me error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

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
    if (respondIfOtpLocked(res, error)) return;
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

    try {
      await sendWelcomeEmail(email, user.fullName);
    } catch (emailError) {
      console.error('Failed to send welcome email after OTP verification:', emailError);
    }

    const latestSession = await prisma.authToken.findFirst({
      where: { userId: user.id, type: TokenType.REFRESH, sessionId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { sessionId: true },
    });
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      ...(latestSession?.sessionId ? { sid: latestSession.sessionId } : {}),
    });

    return res.json({
      success: true,
      message: 'Email verified successfully',
      data: { token },
    });
  } catch (error) {
    if (respondIfOtpLocked(res, error)) return;
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
    if (respondIfOtpLocked(res, error)) return;
    console.error('Resend OTP error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!validateEmail(email)) {
      return res.status(400).json(errorResponse(400, 'Invalid email'));
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.json({
        success: true,
        message: 'If that email is registered, a reset link has been sent',
      });
    }

    const otp = generateOtp();
    await storeOtp(user.id, otp, TokenType.PASSWORD_RESET);

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
    if (error instanceof OtpLockedError) {
      return res.json({ success: true, message: 'If that email is registered, a reset code has been sent' });
    }
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

    const passwordError = await checkNewPassword(newPassword);
    if (passwordError) {
      return res.status(400).json(errorResponse(400, passwordError));
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(400).json(errorResponse(400, 'Invalid or expired OTP'));
    }

    const codeIsValid = await verifyOtp(user.id, otp, TokenType.PASSWORD_RESET, { consume: false });

    if (!codeIsValid) {
      return res.status(400).json(errorResponse(400, 'Invalid or expired OTP'));
    }

    if (containsPersonalInfo(newPassword, user)) {
      return res.status(400).json(errorResponse(400, PERSONAL_INFO_PASSWORD_MESSAGE));
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

    await revokeAllSessions(user.id);
    await clearFailedLogins(email);
    await recordPasswordChange(user, 'reset');

    return res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    if (respondIfOtpLocked(res, error)) return;
    console.error('Reset password error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const token = getTrimmedString(req.body.refreshToken);

    if (!token) {
      return res.status(400).json(errorResponse(400, 'Refresh token required'));
    }

    const existing = await consumeRefreshToken(token);

    if (existing.status === 'reused') {
      if (existing.sessionId) {
        await revokeSession(existing.sessionId);
      } else {
        await prisma.authToken.deleteMany({ where: { id: existing.tokenId } });
      }
      const owner = await prisma.user.findUnique({
        where: { id: existing.userId },
        select: { id: true, email: true, role: true, fullName: true },
      });
      await raiseSecurityAlert({
        type: 'REFRESH_TOKEN_REUSE',
        severity: 'high',
        message: `A sign-in token for ${owner?.email ?? existing.userId} was used after it had already been replaced — a copy is in someone else's hands. That device's session (${existing.sessionId ?? 'legacy'}) was ended.`,
        actor: owner ? { id: owner.id, email: owner.email, role: owner.role, name: owner.fullName } : { id: existing.userId },
        throttleKey: existing.userId,
        metadata: { sessionId: existing.sessionId },
      });
      if (owner) {
        notifyAccountSecurityEvent(
          owner.email,
          'We signed out one of your devices',
          'One of your HomeEase sign-ins was used from two places at once, which can mean someone copied it. We signed that device out to protect your account. Sign in again on your device; if you see this again, change your password.',
        );
      }
      return res.status(401).json(errorResponse(401, 'Invalid or expired refresh token'));
    }

    if (existing.status === 'race') {
      return res.status(401).json({ ...errorResponse(401, 'Refresh token already used'), code: 'REFRESH_RACE' });
    }

    if (existing.status !== 'ok') {
      return res.status(401).json(errorResponse(401, 'Invalid or expired refresh token'));
    }

    const user = await prisma.user.findUnique({ where: { id: existing.userId } });

    if (!user) {
      return res.status(401).json(errorResponse(401, 'User not found'));
    }

    if (user.status !== 'ACTIVE') {
      return res.status(401).json(errorResponse(401, 'Account is not active'));
    }

    let renewed;
    try {
      renewed = await issueSession(user, existing.sessionId ?? undefined);
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) throw error;
      if (existing.sessionId) await revokeSession(existing.sessionId);
      return res
        .status(401)
        .json({ ...errorResponse(401, 'Your session has ended. Please sign in again.'), code: 'SESSION_EXPIRED' });
    }
    const { token: newToken, refreshToken: newRefreshToken } = renewed;

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

const SUSPENSION_REVIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const requestSuspensionReview = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = getPasswordString(req.body.password);
    const message = getTrimmedString(req.body.message);

    if (!email || !password) {
      return res.status(400).json(errorResponse(400, 'Email and password are required'));
    }
    if (message.length < 10 || message.length > 1000) {
      return res.status(400).json(errorResponse(400, 'Please explain your request in 10 to 1000 characters'));
    }

    if (await isLoginLocked(email)) {
      return res.status(429).json(errorResponse(429, LOGIN_LOCKED_MESSAGE));
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!(await passwordMatches(user, password)) || !user) {
      await failPasswordCheck(email, user);
      return res.status(401).json(errorResponse(401, 'Invalid credentials'));
    }
    await clearFailedLogins(email);
    if (user.status !== 'SUSPENDED' && user.status !== 'BANNED') {
      return res.status(400).json(errorResponse(400, 'Only suspended or banned accounts can request a review'));
    }

    const recent = await prisma.auditLog.findFirst({
      where: {
        actorId: user.id,
        action: 'SUSPENSION_REVIEW_REQUESTED',
        createdAt: { gte: new Date(Date.now() - SUSPENSION_REVIEW_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) {
      return res.status(429).json(errorResponse(429, 'You already requested a review in the last 24 hours. An admin will look at it.'));
    }

    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'SUSPENSION_REVIEW_REQUESTED',
      category: 'STATUS_CHANGE',
      level: 'WARN',
      message: `${user.fullName} (${user.status.toLowerCase()}) requested a review: ${message}`,
      metadata: { userId: user.id, status: user.status, message },
    });

    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
    await Promise.all(
      admins.map((admin) =>
        notifyUser({
          userId: admin.id,
          type: 'SUSPENSION_REVIEW_REQUESTED',
          title: 'Suspension review requested',
          message: `${user.fullName} asked for their ${user.status.toLowerCase()} account to be reviewed: "${message.slice(0, 200)}"`,
          relatedId: user.id,
        })
      )
    );

    return res.status(201).json({
      success: true,
      message: 'Your request was sent. An admin will review it, and if your account is reinstated you will be able to log in again.',
    });
  } catch (error) {
    console.error('Suspension review request error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to send your request'));
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const token = getTrimmedString(req.body.refreshToken);
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json(errorResponse(401, 'Unauthorized'));
    }

    const refreshSessionId = token ? await revokeRefreshToken(token) : null;
    const sessionIds = new Set([refreshSessionId, req.user?.sid].filter((s): s is string => !!s));
    for (const sessionId of sessionIds) {
      await revokeSession(sessionId);
    }

    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

const OTP_CHALLENGE_TOKEN_TTL_SECONDS = 10 * 60;

const maskEmail = (email: string): string => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(1, Math.min(name.length - 1, 5)))}@${domain}`;
};

const maskPhone = (phone: string): string => `•••• ${phone.replace(/\D/g, '').slice(-4)}`;

async function deliverCode(
  user: { id: string; email: string; phone: string | null },
  method: TwoFactorMethod,
  type: TokenType
): Promise<{ method: TwoFactorMethod; destination: string }> {
  const code = generateOtp();
  await storeOtp(user.id, code, type);
  if (method === 'SMS' && user.phone) {
    try {
      await sendOtpSms(user.phone, code);
      return { method: 'SMS', destination: maskPhone(user.phone) };
    } catch (error) {
      console.error('SMS code failed, falling back to email:', error);
    }
  }
  await sendOtpEmail(user.email, code);
  return { method: 'EMAIL', destination: maskEmail(user.email) };
}

async function loginPayload(user: {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  avatar?: string | null;
  role: Role;
  isVerified: boolean;
  mfaEnabled: boolean;
  workerProfile?: { kycStatus: string } | null;
}) {
  const session = await issueSession(user);
  const hasAcceptedTerms =
    user.role === 'CLIENT'
      ? Boolean(
          await prisma.contractAcceptance.findFirst({
            where: { userId: user.id, contractType: 'CLIENT_USER_AGREEMENT' },
            select: { id: true },
          }),
        )
      : undefined;
  return {
    id: user.id,
    name: user.fullName,
    email: user.email,
    phone: user.phone,
    avatar: user.avatar ?? null,
    role: user.role,
    isVerified: user.isVerified,
    kycStatus: user.role === 'WORKER' ? (user.workerProfile?.kycStatus ?? 'PENDING') : undefined,
    hasAcceptedTerms,
    mfaSetupRequired: user.role === 'ADMIN' && !user.mfaEnabled ? true : undefined,
    token: session.token,
    refreshToken: session.refreshToken,
  };
}

function readChallenge(token: string): JwtPayload | null {
  try {
    const payload = verifyToken(token);
    return payload.type === 'otp_pending' ? payload : null;
  } catch {
    return null;
  }
}

export const verifyLoginCode = async (req: Request, res: Response) => {
  try {
    const payload = readChallenge(getTrimmedString(req.body.challengeToken));
    const code = getTrimmedString(req.body.code);
    if (!payload) {
      return res.status(401).json(errorResponse(401, 'Your sign-in expired. Please sign in again.'));
    }
    if (!validateOtp(code)) {
      return res.status(400).json(errorResponse(400, 'Enter the 6-digit code'));
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { workerProfile: { select: { kycStatus: true } } },
    });
    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json(errorResponse(401, 'Your sign-in expired. Please sign in again.'));
    }

    if (!(await verifyOtp(user.id, code, TokenType.LOGIN_2FA))) {
      await writeAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: 'LOGIN_CODE_FAILED',
        category: 'LOGIN',
        level: 'WARN',
        message: `Wrong sign-in code for ${user.email}`,
      });
      return res.status(401).json(errorResponse(401, 'That code is wrong or has expired'));
    }

    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'USER_LOGIN_SUCCESS',
      category: 'LOGIN',
      message: `${user.fullName} logged in (two-step code)`,
    });

    return res.json({ success: true, message: 'Login successful', data: await loginPayload(user) });
  } catch (error) {
    if (respondIfOtpLocked(res, error)) return;
    console.error('Verify login code error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const resendLoginCode = async (req: Request, res: Response) => {
  try {
    const payload = readChallenge(getTrimmedString(req.body.challengeToken));
    if (!payload) {
      return res.status(401).json(errorResponse(401, 'Your sign-in expired. Please sign in again.'));
    }
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.status !== 'ACTIVE' || !user.twoFactorMethod) {
      return res.status(401).json(errorResponse(401, 'Your sign-in expired. Please sign in again.'));
    }
    const sent = await deliverCode(user, user.twoFactorMethod, TokenType.LOGIN_2FA);
    return res.json({ success: true, message: 'Code sent', data: sent });
  } catch (error) {
    if (respondIfOtpLocked(res, error)) return;
    console.error('Resend login code error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to send the code'));
  }
};

export const sendTwoFactorCode = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const requested = getTrimmedString(req.body.method).toUpperCase();
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }
    const method = (requested === 'SMS' || requested === 'EMAIL' ? requested : user.twoFactorMethod ?? 'EMAIL') as TwoFactorMethod;
    if (method === 'SMS' && !user.phone) {
      return res.status(400).json(errorResponse(400, 'Add a mobile number to your profile first'));
    }
    const code = generateOtp();
    await storeOtp(user.id, code, TokenType.ACCOUNT_ACTION);
    if (method === 'SMS') {
      try {
        await sendOtpSms(user.phone!, code);
      } catch {
        return res.status(502).json(errorResponse(502, "We couldn't send a text right now. Try email instead."));
      }
      return res.json({ success: true, message: 'Code sent', data: { method, destination: maskPhone(user.phone!) } });
    }
    await sendOtpEmail(user.email, code);
    return res.json({ success: true, message: 'Code sent', data: { method, destination: maskEmail(user.email) } });
  } catch (error) {
    if (respondIfOtpLocked(res, error)) return;
    console.error('Send two-factor code error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to send the code'));
  }
};

export const enableTwoFactor = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const method = getTrimmedString(req.body.method).toUpperCase();
    const code = getTrimmedString(req.body.code);
    if (method !== 'EMAIL' && method !== 'SMS') {
      return res.status(400).json(errorResponse(400, 'method must be EMAIL or SMS'));
    }
    if (!validateOtp(code) || !(await verifyOtp(req.user.userId, code, TokenType.ACCOUNT_ACTION))) {
      return res.status(400).json(errorResponse(400, 'That code is wrong or has expired'));
    }
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { twoFactorMethod: method },
    });
    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'TWO_FACTOR_ENABLED',
      category: 'LOGIN',
      message: `${user.fullName} turned on two-step sign-in (${method})`,
    });
    return res.json({ success: true, message: 'Two-step sign-in is on', data: { twoFactorMethod: method } });
  } catch (error) {
    if (respondIfOtpLocked(res, error)) return;
    console.error('Enable two-factor error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const disableTwoFactor = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }
    const password = getPasswordString(req.body.password);
    const code = getTrimmedString(req.body.code);
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      return res.status(404).json(errorResponse(404, 'User not found'));
    }
    if (!password || !(await comparePassword(password, user.password))) {
      return res.status(401).json(errorResponse(401, 'Password is incorrect'));
    }
    if (!validateOtp(code) || !(await verifyOtp(user.id, code, TokenType.ACCOUNT_ACTION))) {
      return res.status(400).json(errorResponse(400, 'That code is wrong or has expired'));
    }
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorMethod: null } });
    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'TWO_FACTOR_DISABLED',
      category: 'LOGIN',
      level: 'WARN',
      message: `${user.fullName} turned off two-step sign-in`,
    });
    return res.json({ success: true, message: 'Two-step sign-in is off', data: { twoFactorMethod: null } });
  } catch (error) {
    if (respondIfOtpLocked(res, error)) return;
    console.error('Disable two-factor error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const reactivateAccount = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = getPasswordString(req.body.password);
    if (email && (await isLoginLocked(email))) {
      return res.status(429).json(errorResponse(429, LOGIN_LOCKED_MESSAGE));
    }
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (!password || !(await passwordMatches(user, password)) || !user) {
      if (email) await failPasswordCheck(email, user);
      return res.status(401).json(errorResponse(401, 'Invalid credentials'));
    }
    await clearFailedLogins(email);
    if (user.status !== 'DEACTIVATED') {
      return res.status(409).json(errorResponse(409, 'This account is not deactivated'));
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', deactivatedAt: null } }),
      prisma.workerProfile.updateMany({ where: { userId: user.id }, data: { isAvailable: true } }),
    ]);
    await clearUserSessionRevocation(user.id);

    await writeAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'ACCOUNT_REACTIVATED',
      category: 'LOGIN',
      message: `${user.fullName} reactivated their account`,
    });

    return res.json({ success: true, message: 'Your account is active again. Please sign in.' });
  } catch (error) {
    console.error('Reactivate account error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
