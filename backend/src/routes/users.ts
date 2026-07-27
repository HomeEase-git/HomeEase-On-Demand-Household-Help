import { Router } from 'express';
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getPaymentMethods,
  addPaymentMethod,
  updatePaymentMethod,
  setDefaultPaymentMethod,
  deletePaymentMethod,
  updateNotificationPreferences,
  getKYCDocuments,
  submitKYCDocument,
  acceptContract,
  deleteAccount,
  getMyReviews,
} from '../controllers/userController';
import { avatarUpload, uploadAvatar, kycFileUpload, uploadKycFile } from '../controllers/uploadController';
import { authMiddleware } from '../middleware/auth';
import {
  validateUpdateUserProfile,
  validateChangePassword,
  validateAddAddress,
  validateUpdateAddress,
  validateAddPaymentMethod,
  validateUpdatePaymentMethod,
  validateUpdateNotificationPreferences,
  validateSubmitKYCDocument,
  validateSubmitContractAcceptance,
} from '../middleware/validation';

const router = Router();

// All user routes require auth
router.use(authMiddleware);

// Profile routes
router.get('/me', getUserProfile);
router.patch('/me', validateUpdateUserProfile, updateUserProfile);
router.delete('/me', deleteAccount);

// Password route
router.post('/me/change-password', validateChangePassword, changePassword);

// Address routes
router.get('/me/addresses', getAddresses);
router.post('/me/addresses', validateAddAddress, createAddress);
router.patch('/me/addresses/:addressId', validateUpdateAddress, updateAddress);
router.delete('/me/addresses/:addressId', deleteAddress);
router.patch('/me/addresses/:addressId/set-default', setDefaultAddress);

// Payment method routes
router.get('/me/payment-methods', getPaymentMethods);
router.post('/me/payment-methods', validateAddPaymentMethod, addPaymentMethod);
router.patch('/me/payment-methods/:methodId', validateUpdatePaymentMethod, updatePaymentMethod);
router.patch('/me/payment-methods/:methodId/set-default', setDefaultPaymentMethod);
router.delete('/me/payment-methods/:methodId', deletePaymentMethod);

// Notification preferences
router.patch(
  '/me/notification-preferences',
  validateUpdateNotificationPreferences,
  updateNotificationPreferences
);

// Avatar upload
router.post('/me/avatar', avatarUpload, uploadAvatar);

// KYC documents
router.get('/me/kyc-documents', getKYCDocuments);
router.post('/me/kyc-documents', validateSubmitKYCDocument, submitKYCDocument);
router.post('/me/kyc-documents/upload', kycFileUpload, uploadKycFile);

// Contract acceptance
router.post(
  '/me/contract-acceptance',
  validateSubmitContractAcceptance,
  acceptContract
);

// Reviews written by the current client
router.get('/me/reviews', getMyReviews);

export default router;
