import { Router } from 'express';
import { listPackages, approvePackage, rejectPackage } from '../controllers/adminPackageController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listPackages);
router.patch('/:id/approve', approvePackage);
router.patch('/:id/reject', rejectPackage);

export default router;
