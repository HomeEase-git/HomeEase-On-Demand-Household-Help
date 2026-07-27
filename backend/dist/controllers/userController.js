"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyReviews = exports.deleteAccount = exports.acceptContract = exports.submitKYCDocument = exports.getKYCDocuments = exports.updateNotificationPreferences = exports.deletePaymentMethod = exports.setDefaultPaymentMethod = exports.updatePaymentMethod = exports.addPaymentMethod = exports.getPaymentMethods = exports.setDefaultAddress = exports.deleteAddress = exports.updateAddress = exports.createAddress = exports.getAddresses = exports.changePassword = exports.updateUserProfile = exports.getUserProfile = void 0;
const bcrypt = __importStar(require("bcryptjs"));
const database_1 = __importDefault(require("@config/database"));
const errorResponse_1 = require("@utils/errorResponse");
/**
 * GET /api/users/me
 * Get current user profile
 */
const getUserProfile = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const user = await database_1.default.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                role: true,
                isVerified: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        if (!user) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'User not found'));
        }
        return res.status(200).json({
            success: true,
            message: 'Profile retrieved successfully',
            data: user,
        });
    }
    catch (error) {
        console.error('Error fetching user profile:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch profile'));
    }
};
exports.getUserProfile = getUserProfile;
/**
 * PATCH /api/users/me
 * Update user profile
 */
const updateUserProfile = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { fullName, phone } = req.body;
        const updateData = {};
        if (fullName !== undefined)
            updateData.fullName = fullName;
        if (phone !== undefined)
            updateData.phone = phone;
        const updated = await database_1.default.user.update({
            where: { id: req.user.userId },
            data: updateData,
            select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
            },
        });
        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: updated,
        });
    }
    catch (error) {
        console.error('Error updating user profile:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to update profile'));
    }
};
exports.updateUserProfile = updateUserProfile;
/**
 * POST /api/users/me/change-password
 * Change password
 */
const changePassword = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { currentPassword, newPassword } = req.body;
        const user = await database_1.default.user.findUnique({
            where: { id: req.user.userId },
            select: { password: true },
        });
        if (!user) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'User not found'));
        }
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Current password is incorrect'));
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await database_1.default.user.update({
            where: { id: req.user.userId },
            data: { password: hashedPassword },
        });
        return res.status(200).json({
            success: true,
            message: 'Password changed successfully',
        });
    }
    catch (error) {
        console.error('Error changing password:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to change password'));
    }
};
exports.changePassword = changePassword;
/**
 * GET /api/users/me/addresses
 */
const getAddresses = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const addresses = await database_1.default.userAddress.findMany({
            where: { userId: req.user.userId, isDeleted: false },
            orderBy: { isDefault: 'desc' },
        });
        return res.status(200).json({
            success: true,
            message: 'Addresses retrieved successfully',
            data: addresses,
        });
    }
    catch (error) {
        console.error('Error fetching addresses:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch addresses'));
    }
};
exports.getAddresses = getAddresses;
/**
 * POST /api/users/me/addresses
 */
const createAddress = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { label, street, city, state, zipCode } = req.body;
        const address = await database_1.default.userAddress.create({
            data: {
                userId: req.user.userId,
                label,
                street,
                city,
                state,
                zipCode,
            },
        });
        return res.status(201).json({
            success: true,
            message: 'Address created successfully',
            data: address,
        });
    }
    catch (error) {
        console.error('Error creating address:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to create address'));
    }
};
exports.createAddress = createAddress;
/**
 * PATCH /api/users/me/addresses/:addressId
 */
const updateAddress = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const addressId = req.params.addressId;
        const { label, street, city, state, zipCode } = req.body;
        const address = await database_1.default.userAddress.findFirst({
            where: { id: addressId, isDeleted: false },
        });
        if (!address || address.userId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Cannot update this address'));
        }
        const updateData = {};
        if (label !== undefined)
            updateData.label = label;
        if (street !== undefined)
            updateData.street = street;
        if (city !== undefined)
            updateData.city = city;
        if (state !== undefined)
            updateData.state = state;
        if (zipCode !== undefined)
            updateData.zipCode = zipCode;
        const updated = await database_1.default.userAddress.update({
            where: { id: addressId },
            data: updateData,
        });
        return res.status(200).json({
            success: true,
            message: 'Address updated successfully',
            data: updated,
        });
    }
    catch (error) {
        console.error('Error updating address:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to update address'));
    }
};
exports.updateAddress = updateAddress;
/**
 * DELETE /api/users/me/addresses/:addressId
 */
const deleteAddress = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const addressId = req.params.addressId;
        const address = await database_1.default.userAddress.findFirst({
            where: { id: addressId, isDeleted: false },
        });
        if (!address || address.userId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Cannot delete this address'));
        }
        await database_1.default.userAddress.update({
            where: { id: addressId },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return res.status(200).json({
            success: true,
            message: 'Address deleted successfully',
        });
    }
    catch (error) {
        console.error('Error deleting address:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to delete address'));
    }
};
exports.deleteAddress = deleteAddress;
/**
 * PATCH /api/users/me/addresses/:addressId/set-default
 */
const setDefaultAddress = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const addressId = req.params.addressId;
        const address = await database_1.default.userAddress.findFirst({
            where: { id: addressId, isDeleted: false },
        });
        if (!address || address.userId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Cannot modify this address'));
        }
        await database_1.default.userAddress.updateMany({
            where: { userId: req.user.userId, isDeleted: false, NOT: { id: addressId } },
            data: { isDefault: false },
        });
        const updated = await database_1.default.userAddress.update({
            where: { id: addressId },
            data: { isDefault: true },
        });
        return res.status(200).json({
            success: true,
            message: 'Default address set successfully',
            data: updated,
        });
    }
    catch (error) {
        console.error('Error setting default address:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to set default address'));
    }
};
exports.setDefaultAddress = setDefaultAddress;
/**
 * GET /api/users/me/payment-methods
 */
const getPaymentMethods = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const methods = await database_1.default.savedPaymentMethod.findMany({
            where: { clientProfile: { userId: req.user.userId } },
            select: {
                id: true,
                type: true,
                accountIdentifier: true,
                label: true,
                isDefault: true,
                createdAt: true,
            },
        });
        return res.status(200).json({
            success: true,
            message: 'Payment methods retrieved successfully',
            data: methods,
        });
    }
    catch (error) {
        console.error('Error fetching payment methods:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch payment methods'));
    }
};
exports.getPaymentMethods = getPaymentMethods;
/**
 * POST /api/users/me/payment-methods
 */
const addPaymentMethod = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        if (req.user.role !== 'CLIENT') {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Only clients can add payment methods'));
        }
        const { type, accountIdentifier, label } = req.body;
        const clientProfile = await database_1.default.clientProfile.findUnique({
            where: { userId: req.user.userId },
        });
        if (!clientProfile) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Client profile not found'));
        }
        const method = await database_1.default.savedPaymentMethod.create({
            data: {
                clientProfileId: clientProfile.id,
                type,
                accountIdentifier,
                label: label || `${type} ending in ...${accountIdentifier?.slice(-4) || 'XXXX'}`,
            },
        });
        return res.status(201).json({
            success: true,
            message: 'Payment method added successfully',
            data: method,
        });
    }
    catch (error) {
        console.error('Error adding payment method:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to add payment method'));
    }
};
exports.addPaymentMethod = addPaymentMethod;
/**
 * PATCH /api/users/me/payment-methods/:methodId
 */
const updatePaymentMethod = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const methodId = req.params.methodId;
        const { label } = req.body;
        const method = await database_1.default.savedPaymentMethod.findUnique({
            where: { id: methodId },
            include: { clientProfile: { select: { userId: true } } },
        });
        if (!method || method.clientProfile.userId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Cannot update this payment method'));
        }
        const updated = await database_1.default.savedPaymentMethod.update({
            where: { id: methodId },
            data: { label },
        });
        return res.status(200).json({
            success: true,
            message: 'Payment method updated successfully',
            data: updated,
        });
    }
    catch (error) {
        console.error('Error updating payment method:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to update payment method'));
    }
};
exports.updatePaymentMethod = updatePaymentMethod;
/**
 * PATCH /api/users/me/payment-methods/:methodId/set-default
 */
const setDefaultPaymentMethod = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const methodId = req.params.methodId;
        const method = await database_1.default.savedPaymentMethod.findUnique({
            where: { id: methodId },
            include: { clientProfile: { select: { id: true, userId: true } } },
        });
        if (!method || method.clientProfile.userId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Cannot update this payment method'));
        }
        await database_1.default.$transaction([
            database_1.default.savedPaymentMethod.updateMany({
                where: { clientProfileId: method.clientProfile.id },
                data: { isDefault: false },
            }),
            database_1.default.savedPaymentMethod.update({
                where: { id: methodId },
                data: { isDefault: true },
            }),
        ]);
        return res.status(200).json({
            success: true,
            message: 'Default payment method updated',
        });
    }
    catch (error) {
        console.error('Error setting default payment method:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to set default payment method'));
    }
};
exports.setDefaultPaymentMethod = setDefaultPaymentMethod;
/**
 * DELETE /api/users/me/payment-methods/:methodId
 */
const deletePaymentMethod = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const methodId = req.params.methodId;
        const method = await database_1.default.savedPaymentMethod.findUnique({
            where: { id: methodId },
            include: { clientProfile: { select: { userId: true } } },
        });
        if (!method || method.clientProfile.userId !== req.user.userId) {
            return res.status(403).json((0, errorResponse_1.errorResponse)(403, 'Cannot delete this payment method'));
        }
        await database_1.default.savedPaymentMethod.delete({
            where: { id: methodId },
        });
        return res.status(200).json({
            success: true,
            message: 'Payment method deleted successfully',
        });
    }
    catch (error) {
        console.error('Error deleting payment method:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to delete payment method'));
    }
};
exports.deletePaymentMethod = deletePaymentMethod;
/**
 * PATCH /api/users/me/notification-preferences
 */
const updateNotificationPreferences = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { bookingUpdates, messages, promotions, systemNotifications } = req.body;
        const current = await database_1.default.user.findUnique({
            where: { id: req.user.userId },
            select: { notificationPreferences: true },
        });
        if (!current) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'User not found'));
        }
        const existing = current.notificationPreferences ?? {};
        const updated = await database_1.default.user.update({
            where: { id: req.user.userId },
            data: {
                notificationPreferences: {
                    bookingUpdates: bookingUpdates ?? existing.bookingUpdates ?? true,
                    messages: messages ?? existing.messages ?? true,
                    promotions: promotions ?? existing.promotions ?? false,
                    systemNotifications: systemNotifications ?? existing.systemNotifications ?? true,
                },
            },
            select: { notificationPreferences: true },
        });
        return res.status(200).json({
            success: true,
            message: 'Notification preferences updated successfully',
            data: updated.notificationPreferences,
        });
    }
    catch (error) {
        console.error('Error updating notification preferences:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to update notification preferences'));
    }
};
exports.updateNotificationPreferences = updateNotificationPreferences;
/**
 * GET /api/users/me/kyc-documents
 */
const getKYCDocuments = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        // KycDocument has no userId field — it hangs off VerificationRequest
        const documents = await database_1.default.kycDocument.findMany({
            where: { verificationRequest: { userId: req.user.userId } },
            orderBy: { createdAt: 'desc' },
        });
        return res.status(200).json({
            success: true,
            message: 'KYC documents retrieved successfully',
            data: documents,
        });
    }
    catch (error) {
        console.error('Error fetching KYC documents:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch KYC documents'));
    }
};
exports.getKYCDocuments = getKYCDocuments;
/**
 * POST /api/users/me/kyc-documents
 */
const submitKYCDocument = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { documentType, documentUrl } = req.body;
        // KycDocument has no userId field — it must belong to a VerificationRequest.
        // Reuse the user's open request if one exists, otherwise start a new one.
        let verificationRequest = await database_1.default.verificationRequest.findFirst({
            where: {
                userId: req.user.userId,
                status: { in: ['PENDING', 'SUBMITTED'] },
            },
            orderBy: { submittedAt: 'desc' },
        });
        if (!verificationRequest) {
            verificationRequest = await database_1.default.verificationRequest.create({
                data: {
                    userId: req.user.userId,
                    type: 'WORKER_ONBOARDING',
                    status: 'PENDING',
                },
            });
        }
        const document = await database_1.default.kycDocument.create({
            data: {
                verificationRequestId: verificationRequest.id,
                documentType,
                fileUrl: documentUrl,
                status: 'PENDING',
            },
        });
        return res.status(201).json({
            success: true,
            message: 'KYC document submitted successfully',
            data: document,
        });
    }
    catch (error) {
        console.error('Error submitting KYC document:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to submit KYC document'));
    }
};
exports.submitKYCDocument = submitKYCDocument;
/**
 * POST /api/users/me/contract-acceptance
 */
const acceptContract = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { contractType, acceptedAt } = req.body;
        const acceptance = await database_1.default.contractAcceptance.create({
            data: {
                userId: req.user.userId,
                contractType,
                acceptedAt: acceptedAt ? new Date(acceptedAt) : new Date(),
            },
        });
        return res.status(201).json({
            success: true,
            message: 'Contract acceptance recorded successfully',
            data: acceptance,
        });
    }
    catch (error) {
        console.error('Error recording contract acceptance:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to record contract acceptance'));
    }
};
exports.acceptContract = acceptContract;
/**
 * DELETE /api/users/me
 */
const deleteAccount = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { password } = req.body;
        if (!password) {
            return res.status(400).json((0, errorResponse_1.errorResponse)(400, 'Password required to delete account'));
        }
        const user = await database_1.default.user.findUnique({
            where: { id: req.user.userId },
            select: { password: true },
        });
        if (!user) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'User not found'));
        }
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Password is incorrect'));
        }
        await database_1.default.user.update({
            where: { id: req.user.userId },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
                status: 'DELETED',
            },
        });
        return res.status(200).json({
            success: true,
            message: 'Account deleted successfully',
        });
    }
    catch (error) {
        console.error('Error deleting account:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to delete account'));
    }
};
exports.deleteAccount = deleteAccount;
/**
 * GET /api/users/me/reviews
 * Get reviews the current client has written
 */
const getMyReviews = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { page = '1', limit = '10' } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
        const skip = (pageNum - 1) * limitNum;
        const [reviews, total] = await Promise.all([
            database_1.default.review.findMany({
                where: { clientId: req.user.userId },
                include: {
                    booking: {
                        select: {
                            id: true,
                            workerId: true,
                            serviceTask: { select: { name: true } },
                            worker: { select: { fullName: true } },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum,
            }),
            database_1.default.review.count({ where: { clientId: req.user.userId } }),
        ]);
        const formattedReviews = reviews.map((review) => ({
            id: review.id,
            bookingId: review.booking.id,
            workerId: review.booking.workerId,
            workerName: review.booking.worker?.fullName ?? 'Worker',
            serviceType: review.booking.serviceTask?.name ?? 'Service',
            rating: review.rating,
            comment: review.comment,
            createdAt: review.createdAt,
        }));
        return res.status(200).json({
            success: true,
            message: 'Reviews retrieved successfully',
            data: {
                reviews: formattedReviews,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum),
                },
            },
        });
    }
    catch (error) {
        console.error('Error fetching my reviews:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch reviews'));
    }
};
exports.getMyReviews = getMyReviews;
//# sourceMappingURL=userController.js.map