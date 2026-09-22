import { Router } from 'express';
import { listDisputes, getDisputeById, getDisputeHistoryForUser, resolveDispute } from '../controllers/adminDisputeController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listDisputes);
router.get('/history/:userId', getDisputeHistoryForUser);
router.get('/:id', getDisputeById);
router.patch('/:id/resolve', resolveDispute);

export default router;
