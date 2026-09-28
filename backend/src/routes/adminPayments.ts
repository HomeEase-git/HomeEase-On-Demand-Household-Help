import { Router } from 'express';
import { listPayments, getPaymentById, listPayouts, exportPayouts, retryPayout } from '../controllers/adminPaymentController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import { listRefundRequests, approveRefund, rejectRefund, markRefundManual } from '../controllers/adminRefundController';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

// Registered before '/:id' so 'payouts' isn't swallowed as a payment id.
router.get('/payouts', listPayouts);
router.get('/payouts/export', exportPayouts);
router.patch('/payouts/:id/retry', retryPayout);
// Refunds of paid bookings wait here for an admin decision.
router.get('/refund-requests', listRefundRequests);
router.post('/refund-requests/:id/approve', approveRefund);
router.post('/refund-requests/:id/reject', rejectRefund);
router.post('/refund-requests/:id/manual', markRefundManual);
router.get('/', listPayments);
router.get('/:id', getPaymentById);

export default router;
