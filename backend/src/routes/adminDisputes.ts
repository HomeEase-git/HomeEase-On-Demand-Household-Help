import { Router } from 'express';
import { listDisputes, updateDispute } from '../controllers/adminDisputeController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listDisputes);
router.patch('/:id', updateDispute);

export default router;
