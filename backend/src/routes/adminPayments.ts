import { Router } from 'express';
import { listPayments, getPaymentById } from '../controllers/adminPaymentController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listPayments);
router.get('/:id', getPaymentById);

export default router;
