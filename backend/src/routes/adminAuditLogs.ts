import { Router } from 'express';
import { listAuditLogs } from '../controllers/adminAuditLogController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listAuditLogs);

export default router;
