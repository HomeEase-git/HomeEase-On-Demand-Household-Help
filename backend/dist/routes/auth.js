"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_1 = require("@controllers/authController");
const auth_1 = require("@middleware/auth");
const router = (0, express_1.Router)();
router.post('/signup', authController_1.signup);
router.post('/login', authController_1.login);
router.get('/me', auth_1.authMiddleware, authController_1.getMe);
router.post('/send-otp', authController_1.sendOtp);
router.post('/verify-otp', authController_1.verifyOtpHandler);
router.post('/resend-otp', authController_1.resendOtp);
router.post('/forgot-password', authController_1.forgotPassword);
router.post('/reset-password', authController_1.resetPassword);
router.post('/refresh', authController_1.refreshToken);
router.post('/logout', auth_1.authMiddleware, authController_1.logout);
exports.default = router;
//# sourceMappingURL=auth.js.map