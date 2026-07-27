"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = __importDefault(require("@routes/auth"));
const workers_1 = __importDefault(require("@routes/workers"));
const bookings_1 = __importDefault(require("@routes/bookings"));
const payments_1 = __importDefault(require("@routes/payments"));
const users_1 = __importDefault(require("@routes/users"));
const messages_1 = __importDefault(require("@routes/messages"));
const notifications_1 = __importDefault(require("@routes/notifications"));
const services_1 = __importDefault(require("@routes/services"));
const verification_1 = __importDefault(require("@routes/verification"));
const adminUsers_1 = __importDefault(require("@routes/adminUsers"));
const adminBookings_1 = __importDefault(require("@routes/adminBookings"));
const adminPayments_1 = __importDefault(require("@routes/adminPayments"));
const adminReviews_1 = __importDefault(require("@routes/adminReviews"));
const adminDisputes_1 = __importDefault(require("@routes/adminDisputes"));
const adminVerifications_1 = __importDefault(require("@routes/adminVerifications"));
const errorHandler_1 = require("@middleware/errorHandler");
const app = (0, express_1.default)();
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '1mb';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
// Middleware
app.use(express_1.default.json({ limit: jsonBodyLimit }));
app.use(express_1.default.urlencoded({ extended: true, limit: jsonBodyLimit }));
app.use((0, cors_1.default)({
    origin: allowedOrigins,
    credentials: true,
}));
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/workers', workers_1.default);
app.use('/api/bookings', bookings_1.default);
app.use('/api/payments', payments_1.default);
app.use('/api/users', users_1.default);
app.use('/api/messages', messages_1.default);
app.use('/api/notifications', notifications_1.default);
app.use('/api/services', services_1.default);
app.use('/api/verification', verification_1.default);
app.use('/api/admin/users', adminUsers_1.default);
app.use('/api/admin/bookings', adminBookings_1.default);
app.use('/api/admin/payments', adminPayments_1.default);
app.use('/api/admin/reviews', adminReviews_1.default);
app.use('/api/admin/disputes', adminDisputes_1.default);
app.use('/api/admin/verifications', adminVerifications_1.default);
// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'OK' });
});
// Error handling
app.use(errorHandler_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map