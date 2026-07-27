import { Router } from 'express';
import { getAnalytics } from '../controllers/adminAnalyticsController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', getAnalytics);

export default router;
