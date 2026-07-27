"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const userController_1 = require("../controllers/userController");
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const router = (0, express_1.Router)();
// All user routes require auth
router.use(auth_1.authMiddleware);
// Profile routes
router.get('/me', userController_1.getUserProfile);
router.patch('/me', validation_1.validateUpdateUserProfile, userController_1.updateUserProfile);
router.delete('/me', userController_1.deleteAccount);
// Password route
router.post('/me/change-password', validation_1.validateChangePassword, userController_1.changePassword);
// Address routes
router.get('/me/addresses', userController_1.getAddresses);
router.post('/me/addresses', validation_1.validateAddAddress, userController_1.createAddress);
router.patch('/me/addresses/:addressId', validation_1.validateUpdateAddress, userController_1.updateAddress);
router.delete('/me/addresses/:addressId', userController_1.deleteAddress);
router.patch('/me/addresses/:addressId/set-default', userController_1.setDefaultAddress);
// Payment method routes
router.get('/me/payment-methods', userController_1.getPaymentMethods);
router.post('/me/payment-methods', validation_1.validateAddPaymentMethod, userController_1.addPaymentMethod);
router.patch('/me/payment-methods/:methodId', validation_1.validateUpdatePaymentMethod, userController_1.updatePaymentMethod);
router.patch('/me/payment-methods/:methodId/set-default', userController_1.setDefaultPaymentMethod);
router.delete('/me/payment-methods/:methodId', userController_1.deletePaymentMethod);
// Notification preferences
router.patch('/me/notification-preferences', validation_1.validateUpdateNotificationPreferences, userController_1.updateNotificationPreferences);
// KYC documents
router.get('/me/kyc-documents', userController_1.getKYCDocuments);
router.post('/me/kyc-documents', validation_1.validateSubmitKYCDocument, userController_1.submitKYCDocument);
// Contract acceptance
router.post('/me/contract-acceptance', validation_1.validateSubmitContractAcceptance, userController_1.acceptContract);
// Reviews written by the current client
router.get('/me/reviews', userController_1.getMyReviews);
exports.default = router;
//# sourceMappingURL=users.js.map