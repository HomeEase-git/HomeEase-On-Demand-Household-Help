import { Router } from 'express';
import {
  listVatRegistrations,
  approveVatRegistration,
  rejectVatRegistration,
} from '../controllers/adminVatController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listVatRegistrations);
router.patch('/:workerId/approve', approveVatRegistration);
router.patch('/:workerId/reject', rejectVatRegistration);

export default router;
