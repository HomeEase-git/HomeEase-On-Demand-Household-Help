import { Router } from 'express';
import { uploadVerificationDocuments, getMyVerifications, verificationUpload } from '../controllers/verificationController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import { requireVerifiedEmail } from '../middleware/verifiedEmail';

const router = Router();

router.post(
  '/upload',
  authMiddleware,
  restrictTo('CLIENT', 'WORKER'),
  requireVerifiedEmail,
  verificationUpload.array('documents', 5),
  uploadVerificationDocuments
);

router.get('/mine', authMiddleware, restrictTo('CLIENT', 'WORKER'), getMyVerifications);

export default router;
