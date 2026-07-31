import { Router } from 'express';
import {
  searchWorkers,
  getWorkerDetail,
  getWorkerReviews,
  getWorkerAvailability,
  getWorkerBlockedDates,
  updateAvailability,
  updateWorkerProfile,
  addServiceTypes,
  getWorkerCapacity,
  listMySkills,
  createSkill,
  deleteSkill,
  listMyCertifications,
  getCertification,
  createCertification,
  deleteCertification,
  getPayoutMethod,
  updatePayoutMethod,
} from '../controllers/workerController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import {
  validateUpdateAvailability,
  validateUpdateWorkerProfile,
  validateAddServiceTypes,
  validateCreateSkill,
  validateCreateCertification,
  validateUpdatePayoutMethod,
} from '../middleware/validation';

const router = Router();

// Public routes (no auth required)
router.get('/', searchWorkers);
router.get('/:workerId', getWorkerDetail);
router.get('/:workerId/reviews', getWorkerReviews);
router.get('/:workerId/availability', getWorkerAvailability);
router.get('/:workerId/blocked-dates', getWorkerBlockedDates);

// Protected routes (auth + worker only)
router.patch(
  '/me/availability',
  authMiddleware,
  restrictTo('WORKER'),
  validateUpdateAvailability,
  updateAvailability
);

router.patch(
  '/me/profile',
  authMiddleware,
  restrictTo('WORKER'),
  validateUpdateWorkerProfile,
  updateWorkerProfile
);

router.post(
  '/me/service-types',
  authMiddleware,
  restrictTo('WORKER'),
  validateAddServiceTypes,
  addServiceTypes
);

router.get(
  '/me/capacity',
  authMiddleware,
  restrictTo('WORKER'),
  getWorkerCapacity
);

router.get('/me/skills', authMiddleware, restrictTo('WORKER'), listMySkills);
router.post('/me/skills', authMiddleware, restrictTo('WORKER'), validateCreateSkill, createSkill);
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
router.delete('/me/certifications/:certId', authMiddleware, restrictTo('WORKER'), deleteCertification);

router.get('/me/payout', authMiddleware, restrictTo('WORKER'), getPayoutMethod);
router.patch(
  '/me/payout',
  authMiddleware,
  restrictTo('WORKER'),
  validateUpdatePayoutMethod,
  updatePayoutMethod
);

export default router;
