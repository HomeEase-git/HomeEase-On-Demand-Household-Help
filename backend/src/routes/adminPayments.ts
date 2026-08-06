import { Router } from 'express';
import { listPayments, getPaymentById, listPayouts, exportPayouts, retryPayout } from '../controllers/adminPaymentController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

// Registered before '/:id' so 'payouts' isn't swallowed as a payment id.
router.get('/payouts', listPayouts);
router.get('/payouts/export', exportPayouts);
router.patch('/payouts/:id/retry', retryPayout);
router.get('/', listPayments);
router.get('/:id', getPaymentById);

export default router;
