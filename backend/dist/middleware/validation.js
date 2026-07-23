"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSendMessage = exports.validateSubmitContractAcceptance = exports.validateSubmitKYCDocument = exports.validateUpdateNotificationPreferences = exports.validateUpdateAddress = exports.validateAddAddress = exports.validateChangePassword = exports.validateUpdateUserProfile = exports.validateRefundPayment = exports.validateReleaseEscrow = exports.validateAddPaymentMethod = exports.validateRescheduleBooking = exports.validateAddReview = exports.validateAddAddon = exports.validateDisputeQuote = exports.validateApproveQuote = exports.validateBookingStatusUpdate = exports.validateSubmitQuote = exports.validateCreateBooking = exports.validateAddServiceTypes = exports.validateUpdateWorkerProfile = exports.validateUpdateAvailability = void 0;
const errorResponse_1 = require("../utils/errorResponse");
/**
 * Validates that required fields are present and returns 400 if missing.
 * Used across all routes to short-circuit Prisma calls before they happen.
 */
// Worker validators
const validateUpdateAvailability = (req, res, next) => {
    const { isAvailable, availableDays } = req.body;
    if (typeof isAvailable !== 'boolean') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'isAvailable must be a boolean'));
    }
    if (availableDays !== undefined) {
        if (!Array.isArray(availableDays)) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'availableDays must be an array'));
        }
        const validDays = [0, 1, 2, 3, 4, 5, 6];
        if (!availableDays.every((day) => typeof day === 'number' && validDays.includes(day))) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'availableDays must contain integers 0 (Sun) through 6 (Sat)'));
        }
    }
    return next();
};
exports.validateUpdateAvailability = validateUpdateAvailability;
const validateUpdateWorkerProfile = (req, res, next) => {
    const { bio, serviceAreaRadius, address, city, state, zipCode, kycStatus, kycSubmittedAt, kycApprovedAt, resumeUrl, } = req.body;
    if (bio !== undefined && typeof bio !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'bio must be a string'));
    }
    if (serviceAreaRadius !== undefined) {
        if (typeof serviceAreaRadius !== 'number' || serviceAreaRadius < 0) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'serviceAreaRadius must be a non-negative number'));
        }
    }
    if (address !== undefined && typeof address !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'address must be a string'));
    }
    if (city !== undefined && typeof city !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'city must be a string'));
    }
    if (state !== undefined && typeof state !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'state must be a string'));
    }
    if (zipCode !== undefined && typeof zipCode !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'zipCode must be a string'));
    }
    const allowedKycStatuses = ['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'];
    if (kycStatus !== undefined && !allowedKycStatuses.includes(kycStatus)) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'kycStatus must be one of PENDING, SUBMITTED, APPROVED, or REJECTED'));
    }
    if (kycSubmittedAt !== undefined && isNaN(new Date(kycSubmittedAt).getTime())) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'kycSubmittedAt must be a valid date'));
    }
    if (kycApprovedAt !== undefined && isNaN(new Date(kycApprovedAt).getTime())) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'kycApprovedAt must be a valid date'));
    }
    if (resumeUrl !== undefined && typeof resumeUrl !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'resumeUrl must be a string'));
    }
    return next();
};
exports.validateUpdateWorkerProfile = validateUpdateWorkerProfile;
const validateAddServiceTypes = (req, res, next) => {
    const { serviceTypeIds } = req.body;
    if (!Array.isArray(serviceTypeIds) || serviceTypeIds.length === 0) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'serviceTypeIds must be a non-empty array'));
    }
    if (!serviceTypeIds.every((id) => typeof id === 'string')) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'All serviceTypeIds must be strings'));
    }
    return next();
};
exports.validateAddServiceTypes = validateAddServiceTypes;
// Booking validators
const validateCreateBooking = (req, res, next) => {
    const { workerId, serviceTaskId, location, scheduledDate, scheduledTime, estimatedPrice, estimatedDurationHours, inspectionFeeCharged, inspectionFeeAmount, } = req.body;
    if (!workerId || typeof workerId !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'workerId is required and must be a string'));
    }
    if (!serviceTaskId || typeof serviceTaskId !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'serviceTaskId is required and must be a string'));
    }
    if (!location || typeof location !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'location is required and must be a string'));
    }
    if (!scheduledDate) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'scheduledDate is required'));
    }
    if (!scheduledTime || typeof scheduledTime !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'scheduledTime is required and must be a string'));
    }
    if (typeof estimatedPrice !== 'number' || estimatedPrice <= 0) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'estimatedPrice must be a positive number'));
    }
    if (estimatedDurationHours !== undefined) {
        if (typeof estimatedDurationHours !== 'number' || estimatedDurationHours < 0) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'estimatedDurationHours must be a non-negative number'));
        }
    }
    if (inspectionFeeCharged !== undefined && typeof inspectionFeeCharged !== 'boolean') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'inspectionFeeCharged must be a boolean'));
    }
    if (inspectionFeeAmount !== undefined) {
        if (typeof inspectionFeeAmount !== 'number' || inspectionFeeAmount < 0) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'inspectionFeeAmount must be a non-negative number'));
        }
    }
    return next();
};
exports.validateCreateBooking = validateCreateBooking;
const validateSubmitQuote = (req, res, next) => {
    const { laborCost, materialsCost, notes } = req.body;
    if (typeof laborCost !== 'number' || laborCost < 0) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'laborCost must be a non-negative number'));
    }
    if (typeof materialsCost !== 'number' || materialsCost < 0) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'materialsCost must be a non-negative number'));
    }
    if (notes !== undefined && typeof notes !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'notes must be a string'));
    }
    return next();
};
exports.validateSubmitQuote = validateSubmitQuote;
const validateBookingStatusUpdate = (req, res, next) => {
    const { reason } = req.body;
    if (reason !== undefined && typeof reason !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'reason must be a string'));
    }
    return next();
};
exports.validateBookingStatusUpdate = validateBookingStatusUpdate;
const validateApproveQuote = (_req, _res, next) => {
    // Quote approval needs no additional fields beyond ID in params
    return next();
};
exports.validateApproveQuote = validateApproveQuote;
const validateDisputeQuote = (req, res, next) => {
    const { reason } = req.body;
    if (!reason || typeof reason !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'reason is required and must be a string'));
    }
    return next();
};
exports.validateDisputeQuote = validateDisputeQuote;
const validateAddAddon = (req, res, next) => {
    const { title, description, cost } = req.body;
    if (!title || typeof title !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'title is required and must be a string'));
    }
    if (description && typeof description !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'description must be a string'));
    }
    if (typeof cost !== 'number' || cost <= 0) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'cost is required and must be a positive number'));
    }
    return next();
};
exports.validateAddAddon = validateAddAddon;
const validateAddReview = (req, res, next) => {
    const { rating, comment } = req.body;
    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'rating must be a number between 1 and 5'));
    }
    if (!comment || typeof comment !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'comment is required and must be a string'));
    }
    return next();
};
exports.validateAddReview = validateAddReview;
const validateRescheduleBooking = (req, res, next) => {
    const { newDate, newTime } = req.body;
    if (!newDate) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'newDate is required'));
    }
    if (!newTime || typeof newTime !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'newTime is required and must be a string'));
    }
    return next();
};
exports.validateRescheduleBooking = validateRescheduleBooking;
const validPaymentMethodTypes = ['GCASH', 'MAYA', 'CARD', 'BANK_TRANSFER', 'CASH'];
// Payment validators
const validateAddPaymentMethod = (req, res, next) => {
    const { type, accountIdentifier } = req.body;
    if (!type || typeof type !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'type is required and must be a string'));
    }
    if (!validPaymentMethodTypes.includes(type.toUpperCase())) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, `Invalid type "${type}". Allowed values: GCASH, MAYA, CARD, BANK_TRANSFER, CASH`));
    }
    if (!accountIdentifier || typeof accountIdentifier !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'accountIdentifier is required and must be a string'));
    }
    return next();
};
exports.validateAddPaymentMethod = validateAddPaymentMethod;
const validateReleaseEscrow = (_req, _res, next) => {
    // Release escrow needs no additional fields
    return next();
};
exports.validateReleaseEscrow = validateReleaseEscrow;
const validateRefundPayment = (req, res, next) => {
    const { reason } = req.body;
    if (reason !== undefined && typeof reason !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'reason must be a string'));
    }
    return next();
};
exports.validateRefundPayment = validateRefundPayment;
// User validators
const validateUpdateUserProfile = (req, res, next) => {
    const { fullName, phone, avatar } = req.body;
    if (fullName !== undefined && typeof fullName !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'fullName must be a string'));
    }
    if (phone !== undefined && typeof phone !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'phone must be a string'));
    }
    if (avatar !== undefined && typeof avatar !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'avatar must be a string'));
    }
    return next();
};
exports.validateUpdateUserProfile = validateUpdateUserProfile;
const validateChangePassword = (req, res, next) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || typeof currentPassword !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'currentPassword is required and must be a string'));
    }
    if (!newPassword || typeof newPassword !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'newPassword is required and must be a string'));
    }
    if (newPassword.length < 8) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'newPassword must be at least 8 characters'));
    }
    return next();
};
exports.validateChangePassword = validateChangePassword;
const validateAddAddress = (req, res, next) => {
    const { label, street, city, state, zipCode } = req.body;
    if (!label || typeof label !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'label is required and must be a string'));
    }
    if (!street || typeof street !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'street is required and must be a string'));
    }
    if (!city || typeof city !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'city is required and must be a string'));
    }
    if (!state || typeof state !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'state is required and must be a string'));
    }
    if (!zipCode || typeof zipCode !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'zipCode is required and must be a string'));
    }
    return next();
};
exports.validateAddAddress = validateAddAddress;
const validateUpdateAddress = (req, res, next) => {
    const { label, street, city, state, zipCode } = req.body;
    if (label !== undefined && typeof label !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'label must be a string'));
    }
    if (street !== undefined && typeof street !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'street must be a string'));
    }
    if (city !== undefined && typeof city !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'city must be a string'));
    }
    if (state !== undefined && typeof state !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'state must be a string'));
    }
    if (zipCode !== undefined && typeof zipCode !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'zipCode must be a string'));
    }
    return next();
};
exports.validateUpdateAddress = validateUpdateAddress;
const validateUpdateNotificationPreferences = (req, res, next) => {
    const { bookingUpdates, messages, promotions, systemNotifications } = req.body;
    if (bookingUpdates !== undefined &&
        typeof bookingUpdates !== 'boolean') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'bookingUpdates must be a boolean'));
    }
    if (messages !== undefined && typeof messages !== 'boolean') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'messages must be a boolean'));
    }
    if (promotions !== undefined && typeof promotions !== 'boolean') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'promotions must be a boolean'));
    }
    if (systemNotifications !== undefined && typeof systemNotifications !== 'boolean') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'systemNotifications must be a boolean'));
    }
    return next();
};
exports.validateUpdateNotificationPreferences = validateUpdateNotificationPreferences;
const validateSubmitKYCDocument = (req, res, next) => {
    const { documentType, documentUrl } = req.body;
    const allowedDocumentTypes = [
        'GOVERNMENT_ID_FRONT',
        'GOVERNMENT_ID_BACK',
        'SELFIE',
        'RESUME',
        'CERTIFICATION',
        'NBI_CLEARANCE',
        'BARANGAY_CLEARANCE',
        'POLICE_CLEARANCE',
        'CEDULA',
    ];
    if (!documentType || typeof documentType !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'documentType is required and must be a string'));
    }
    if (!allowedDocumentTypes.includes(documentType)) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'documentType is not supported'));
    }
    if (!documentUrl || typeof documentUrl !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'documentUrl is required and must be a string'));
    }
    return next();
};
exports.validateSubmitKYCDocument = validateSubmitKYCDocument;
const validateSubmitContractAcceptance = (req, res, next) => {
    const { contractType, acceptedAt } = req.body;
    if (!contractType || typeof contractType !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'contractType is required and must be a string'));
    }
    if (acceptedAt !== undefined && isNaN(new Date(acceptedAt).getTime())) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'acceptedAt must be a valid date'));
    }
    return next();
};
exports.validateSubmitContractAcceptance = validateSubmitContractAcceptance;
// Message validators
const validateSendMessage = (req, res, next) => {
    const { receiverId, content } = req.body;
    if (!receiverId || typeof receiverId !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'receiverId is required and must be a string'));
    }
    if (!content || typeof content !== 'string') {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'content is required and must be a string'));
    }
    if (content.trim().length === 0) {
        return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'content cannot be empty'));
    }
    return next();
};
exports.validateSendMessage = validateSendMessage;
//# sourceMappingURL=validation.js.map