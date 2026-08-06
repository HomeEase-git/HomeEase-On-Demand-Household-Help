import { Router } from 'express';
import {
  listVerifications,
  getVerificationById,
  approveVerification,
  rejectVerification,
  rerunVerification,
  approveDocument,
  rejectDocument,
} from '../controllers/adminVerificationController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listVerifications);
router.get('/:id', getVerificationById);
router.patch('/:id/approve', approveVerification);
router.patch('/:id/reject', rejectVerification);
router.patch('/:id/rerun', rerunVerification);
router.patch('/:id/documents/:documentId/approve', approveDocument);
router.patch('/:id/documents/:documentId/reject', rejectDocument);

export default router;
