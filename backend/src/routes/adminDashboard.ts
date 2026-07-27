import { Router } from 'express';
import { getDashboardStats } from '../controllers/adminDashboardController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/stats', getDashboardStats);

export default router;
