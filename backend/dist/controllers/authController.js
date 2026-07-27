"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logout = exports.refreshToken = exports.resetPassword = exports.forgotPassword = exports.resendOtp = exports.verifyOtpHandler = exports.sendOtp = exports.getMe = exports.login = exports.signup = void 0;
const database_1 = __importDefault(require("@config/database"));
const passwordHash_1 = require("@utils/passwordHash");
const jwt_1 = require("@utils/jwt");
const validators_1 = require("@utils/validators");
const errorResponse_1 = require("@utils/errorResponse");
const emailService_1 = require("@utils/emailService");
const otpService_1 = require("@utils/otpService");
const crypto_1 = __importDefault(require("crypto"));
const getTrimmedString = (value) => {
    return typeof value === 'string' ? value.trim() : '';
};
const getPasswordString = (value) => {
    return typeof value === 'string' ? value : '';
};
const normalizeEmail = (value) => {
    return getTrimmedString(value).toLowerCase();
};
const normalizeSignupRole = (value) => {
    const role = getTrimmedString(value).toUpperCase();
    if (role === 'CLIENT' || role === 'WORKER')
        return role;
    return null;
};
// ============================================================================
// SIGNUP
// ============================================================================
const signup = async (req, res) => {
    try {
        const fullName = getTrimmedString(req.body.fullName);
        const email = normalizeEmail(req.body.email);
        const phone = getTrimmedString(req.body.phone);
        const password = getPasswordString(req.body.password);
        const role = normalizeSignupRole(req.body.role);
        if (!fullName || !email || !phone || !password || !req.body.role) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Missing required fields'));
        }
        if (!role) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Role must be either CLIENT or WORKER'));
        }
        if (!(0, validators_1.validateEmail)(email)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid email format'));
        }
        if (!(0, validators_1.validatePassword)(password)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Password must be at least 8 characters with 1 uppercase letter and 1 number'));
        }
        if (!(0, validators_1.validatePhone)(phone)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid phone number'));
        }
        const existingUser = await database_1.default.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(409).json((0, errorResponse_1.errorResponse)(409, 'Email already registered'));
        }
        const hashedPassword = await (0, passwordHash_1.hashPassword)(password);
        const user = await database_1.default.$transaction(async (tx) => {
            const createdUser = await tx.user.create({
                data: { fullName, email, phone, password: hashedPassword, role },
            });
            if (role === 'WORKER') {
                await tx.workerProfile.create({ data: { userId: createdUser.id } });
            }
            else {
                await tx.clientProfile.create({ data: { userId: createdUser.id } });
            }
            return createdUser;
        });
        // Generate and send OTP — the account is already created at this point,
        // so a failed email send shouldn't turn a successful signup into a 500.
        const otp = (0, otpService_1.generateOtp)();
        await (0, otpService_1.storeOtp)(user.id, otp);
        try {
            await (0, emailService_1.sendOtpEmail)(email, otp);
        }
        catch (emailError) {
            console.error('Failed to send OTP email during signup:', emailError);
        }
        const token = (0, jwt_1.generateToken)({ userId: user.id, email: user.email, role: user.role });
        const refreshToken = crypto_1.default.randomBytes(40).toString('hex');
        await (0, otpService_1.storeRefreshToken)(user.id, refreshToken);
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
                token,
                refreshToken,
            },
        });
    }
    catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.signup = signup;
// ============================================================================
// LOGIN
// ============================================================================
const login = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = getPasswordString(req.body.password);
        if (!email || !password) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Email and password required'));
        }
        const user = await database_1.default.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Invalid credentials'));
        }
        const isPasswordValid = await (0, passwordHash_1.comparePassword)(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Invalid credentials'));
        }
        if (user.status !== 'ACTIVE') {
            const message = user.status === 'SUSPENDED'
                ? 'This account has been suspended. Contact support for assistance.'
                : user.status === 'BANNED'
                    ? 'This account has been banned.'
                    : 'This account no longer exists.';
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, message));
        }
        const token = (0, jwt_1.generateToken)({ userId: user.id, email: user.email, role: user.role });
        const refreshToken = crypto_1.default.randomBytes(40).toString('hex');
        await (0, otpService_1.storeRefreshToken)(user.id, refreshToken);
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
                token,
                refreshToken,
            },
        });
    }
    catch (error) {
        console.error('Login error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.login = login;
// ============================================================================
// GET /api/auth/me
// ============================================================================
const getMe = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const user = await database_1.default.user.findUnique({ where: { id: req.user.userId } });
        if (!user) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'User not found'));
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
            },
        });
    }
    catch (error) {
        console.error('Get me error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.getMe = getMe;
// ============================================================================
// OTP
// ============================================================================
const sendOtp = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        if (!(0, validators_1.validateEmail)(email)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid email'));
        }
        const user = await database_1.default.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'User not found'));
        }
        if (user.isVerified) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Email already verified'));
        }
        const otp = (0, otpService_1.generateOtp)();
        await (0, otpService_1.storeOtp)(user.id, otp);
        await (0, emailService_1.sendOtpEmail)(email, otp);
        return res.json({ success: true, message: 'OTP sent to your email' });
    }
    catch (error) {
        console.error('Send OTP error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.sendOtp = sendOtp;
const verifyOtpHandler = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const otp = getTrimmedString(req.body.otp);
        if (!(0, validators_1.validateEmail)(email)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid email'));
        }
        if (!(0, validators_1.validateOtp)(otp)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'OTP must be 6 digits'));
        }
        const user = await database_1.default.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'User not found'));
        }
        if (user.isVerified) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Email already verified'));
        }
        const isValid = await (0, otpService_1.verifyOtp)(user.id, otp);
        if (!isValid) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid or expired OTP'));
        }
        await database_1.default.user.update({
            where: { id: user.id },
            data: { isVerified: true },
        });
        // Verification already succeeded — a failed welcome email shouldn't undo that.
        try {
            await (0, emailService_1.sendWelcomeEmail)(email, user.fullName);
        }
        catch (emailError) {
            console.error('Failed to send welcome email after OTP verification:', emailError);
        }
        const token = (0, jwt_1.generateToken)({ userId: user.id, email: user.email, role: user.role });
        return res.json({
            success: true,
            message: 'Email verified successfully',
            data: { token },
        });
    }
    catch (error) {
        console.error('Verify OTP error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.verifyOtpHandler = verifyOtpHandler;
const resendOtp = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        if (!(0, validators_1.validateEmail)(email)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid email'));
        }
        const user = await database_1.default.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'User not found'));
        }
        if (user.isVerified) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Email already verified'));
        }
        const otp = (0, otpService_1.generateOtp)();
        await (0, otpService_1.storeOtp)(user.id, otp);
        await (0, emailService_1.sendOtpEmail)(email, otp);
        return res.json({ success: true, message: 'OTP resent to your email' });
    }
    catch (error) {
        console.error('Resend OTP error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.resendOtp = resendOtp;
// ============================================================================
// PASSWORD RESET
// ============================================================================
const forgotPassword = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        if (!(0, validators_1.validateEmail)(email)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid email'));
        }
        const user = await database_1.default.user.findUnique({ where: { email } });
        // Always return success for security — do not reveal if email exists
        if (!user) {
            return res.json({
                success: true,
                message: 'If that email is registered, a reset link has been sent',
            });
        }
        const token = (0, otpService_1.generateResetToken)();
        await (0, otpService_1.storePasswordResetToken)(user.id, token);
        // Must not let a failed send produce a different response than the
        // "email not registered" path above — that would leak account existence.
        try {
            await (0, emailService_1.sendPasswordResetEmail)(email, token);
        }
        catch (emailError) {
            console.error('Failed to send password reset email:', emailError);
        }
        return res.json({
            success: true,
            message: 'If that email is registered, a reset link has been sent',
        });
    }
    catch (error) {
        console.error('Forgot password error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const token = getTrimmedString(req.body.token);
        const newPassword = getPasswordString(req.body.newPassword);
        if (!(0, validators_1.validateEmail)(email)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid email'));
        }
        if (!token) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Reset token is required'));
        }
        if (!(0, validators_1.validatePassword)(newPassword)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Password must be at least 8 characters with 1 uppercase letter and 1 number'));
        }
        const user = await database_1.default.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid or expired reset token'));
        }
        const isValid = await (0, otpService_1.verifyPasswordResetToken)(user.id, token);
        if (!isValid) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Invalid or expired reset token'));
        }
        const hashedPassword = await (0, passwordHash_1.hashPassword)(newPassword);
        await database_1.default.user.update({
            where: { id: user.id },
            data: { password: hashedPassword },
        });
        // Revoke all refresh tokens on password reset for security
        await (0, otpService_1.revokeAllRefreshTokens)(user.id);
        return res.json({ success: true, message: 'Password reset successfully' });
    }
    catch (error) {
        console.error('Reset password error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.resetPassword = resetPassword;
// ============================================================================
// REFRESH TOKEN
// ============================================================================
const refreshToken = async (req, res) => {
    try {
        const token = getTrimmedString(req.body.refreshToken);
        if (!token) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Refresh token required'));
        }
        const userId = await (0, otpService_1.verifyRefreshToken)(token);
        if (!userId) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Invalid or expired refresh token'));
        }
        const user = await database_1.default.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'User not found'));
        }
        // Rotate refresh token
        await (0, otpService_1.revokeRefreshToken)(token);
        const newRefreshToken = crypto_1.default.randomBytes(40).toString('hex');
        await (0, otpService_1.storeRefreshToken)(user.id, newRefreshToken);
        const newToken = (0, jwt_1.generateToken)({ userId: user.id, email: user.email, role: user.role });
        return res.json({
            success: true,
            message: 'Token refreshed',
            data: {
                token: newToken,
                refreshToken: newRefreshToken,
            },
        });
    }
    catch (error) {
        console.error('Refresh token error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.refreshToken = refreshToken;
// ============================================================================
// LOGOUT
// ============================================================================
const logout = async (req, res) => {
    try {
        const token = getTrimmedString(req.body.refreshToken);
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Unauthorized'));
        }
        if (token) {
            await (0, otpService_1.revokeRefreshToken)(token);
        }
        else {
            await (0, otpService_1.revokeAllRefreshTokens)(userId);
        }
        return res.json({ success: true, message: 'Logged out successfully' });
    }
    catch (error) {
        console.error('Logout error:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Internal server error'));
    }
};
exports.logout = logout;
//# sourceMappingURL=authController.js.map