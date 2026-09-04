import { Router } from 'express';
import {
  searchWorkers,
  getWorkerDetail,
  getMyDigitalId,
  getWorkerReviews,
  getWorkerAvailability,
  getWorkerBlockedDates,
  updateAvailability,
  getMyWorkerProfile,
  updateWorkerProfile,
  addServiceTypes,
  listMyServiceTypes,
  removeServiceType,
  getWorkerCapacity,
  listMySkills,
  createSkill,
  updateSkill,
  deleteSkill,
  listMyCertifications,
  getCertification,
  createCertification,
  updateCertification,
  deleteCertification,
  getPayoutMethod,
  updatePayoutMethod,
  getTaxInfo,
  updateTaxInfo,
  getMyTaxCertificates,
  getMyAvailabilitySlots,
  updateAvailabilitySlots,
  updateHourlyRate,
  parseMyResume,
  listMyPackages,
  createPackage,
  updatePackage,
  deletePackage,
  getWorkerPackages,
} from '../controllers/workerController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import {
  validateUpdateAvailability,
  validateUpdateWorkerProfile,
  validateAddServiceTypes,
  validateCreateSkill,
  validateUpdateSkill,
  validateCreateCertification,
  validateUpdateCertification,
  validateUpdatePayoutMethod,
  validateUpdateTaxInfo,
  validateUpdateAvailabilitySlots,
  validateUpdateHourlyRate,
  validateCreatePackage,
  validateUpdatePackage,
} from '../middleware/validation';

const router = Router();

// Public routes (no auth required)
router.get('/', searchWorkers);
router.get('/:workerId', getWorkerDetail);
router.get('/:workerId/reviews', getWorkerReviews);
router.get('/:workerId/availability', getWorkerAvailability);
router.get('/:workerId/blocked-dates', getWorkerBlockedDates);
// NOTE: this wildcard route is registered further down, AFTER '/me/packages'
// — otherwise a request to GET /workers/me/packages would match here first
// with workerId="me" instead of reaching the authenticated "my own
// packages" handler. See the '/me/packages' block below.

// Protected routes (auth + worker only)
router.patch(
  '/me/availability',
  authMiddleware,
  restrictTo('WORKER'),
  validateUpdateAvailability,
  updateAvailability
);

router.get('/me/profile', authMiddleware, restrictTo('WORKER'), getMyWorkerProfile);

router.patch(
  '/me/profile',
  authMiddleware,
  restrictTo('WORKER'),
  validateUpdateWorkerProfile,
  updateWorkerProfile
);

router.get('/me/digital-id', authMiddleware, restrictTo('WORKER'), getMyDigitalId);

router.post('/me/resume/parse', authMiddleware, restrictTo('WORKER'), parseMyResume);

router.get('/me/service-types', authMiddleware, restrictTo('WORKER'), listMyServiceTypes);
router.post(
  '/me/service-types',
  authMiddleware,
  restrictTo('WORKER'),
  validateAddServiceTypes,
  addServiceTypes
);
router.delete('/me/service-types/:serviceTypeId', authMiddleware, restrictTo('WORKER'), removeServiceType);

router.get('/me/packages', authMiddleware, restrictTo('WORKER'), listMyPackages);
router.post('/me/packages', authMiddleware, restrictTo('WORKER'), validateCreatePackage, createPackage);
router.patch('/me/packages/:packageId', authMiddleware, restrictTo('WORKER'), validateUpdatePackage, updatePackage);
router.delete('/me/packages/:packageId', authMiddleware, restrictTo('WORKER'), deletePackage);

// Registered after '/me/packages' above — see the note near the top of the
// public-routes block.
router.get('/:workerId/packages', getWorkerPackages);

router.get(
  '/me/capacity',
  authMiddleware,
  restrictTo('WORKER'),
  getWorkerCapacity
);

router.get('/me/skills', authMiddleware, restrictTo('WORKER'), listMySkills);
router.post('/me/skills', authMiddleware, restrictTo('WORKER'), validateCreateSkill, createSkill);
router.patch('/me/skills/:skillId', authMiddleware, restrictTo('WORKER'), validateUpdateSkill, updateSkill);
router.delete('/me/skills/:skillId', authMiddleware, restrictTo('WORKER'), deleteSkill);

router.get('/me/certifications', authMiddleware, restrictTo('WORKER'), listMyCertifications);
router.get('/me/certifications/:certId', authMiddleware, restrictTo('WORKER'), getCertification);
router.post(
  '/me/certifications',
  authMiddleware,
  restrictTo('WORKER'),
  validateCreateCertification,
  createCertification
);
router.patch(
  '/me/certifications/:certId',
  authMiddleware,
  restrictTo('WORKER'),
  validateUpdateCertification,
  updateCertification
);
router.delete('/me/certifications/:certId', authMiddleware, restrictTo('WORKER'), deleteCertification);

router.get('/me/payout', authMiddleware, restrictTo('WORKER'), getPayoutMethod);
router.patch(
  '/me/payout',
  authMiddleware,
  restrictTo('WORKER'),
  validateUpdatePayoutMethod,
  updatePayoutMethod
);

router.get('/me/tax-info', authMiddleware, restrictTo('WORKER'), getTaxInfo);
router.patch('/me/tax-info', authMiddleware, restrictTo('WORKER'), validateUpdateTaxInfo, updateTaxInfo);
router.get('/me/tax-certificates', authMiddleware, restrictTo('WORKER'), getMyTaxCertificates);

router.get('/me/availability-slots', authMiddleware, restrictTo('WORKER'), getMyAvailabilitySlots);
router.patch(
  '/me/availability-slots',
  authMiddleware,
  restrictTo('WORKER'),
  validateUpdateAvailabilitySlots,
  updateAvailabilitySlots
);

router.patch('/me/rate', authMiddleware, restrictTo('WORKER'), validateUpdateHourlyRate, updateHourlyRate);

export default router;
