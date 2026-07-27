import { Router } from 'express';
import { getServiceReport, getActivityReport } from '../controllers/adminReportsController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/service', getServiceReport);
router.get('/activity', getActivityReport);

export default router;
