import { Router } from 'express';
import { listServiceRequests, approveServiceRequest, rejectServiceRequest } from '../controllers/adminServiceRequestController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listServiceRequests);
router.patch('/:id/approve', approveServiceRequest);
router.patch('/:id/reject', rejectServiceRequest);

export default router;
