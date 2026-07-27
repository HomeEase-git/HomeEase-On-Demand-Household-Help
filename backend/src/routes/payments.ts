import { Router } from 'express';
import {
  createPayment,
  getPaymentDetail,
  listMyPayments,
  releaseEscrow,
  refundPayment,
  createPaymentIntent,
  handlePayMongoWebhook,
} from '../controllers/paymentController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import {
  validateReleaseEscrow,
  validateRefundPayment,
} from '../middleware/validation';

const router = Router();

// PayMongo webhook (no auth required)
router.post('/paymongo/webhook', handlePayMongoWebhook);

// All other routes require auth
router.use(authMiddleware);

// Create payment (client only)
router.post('/:bookingId', restrictTo('CLIENT'), createPayment);

// Get payment detail
router.get('/:bookingId', getPaymentDetail);

// List my payments (client: payments made, worker: payouts)
router.get('/', listMyPayments);

// Release escrow (client only)
router.post('/:id/release', restrictTo('CLIENT'), validateReleaseEscrow, releaseEscrow);

// Refund payment (client only)
router.post('/:id/refund', restrictTo('CLIENT'), validateRefundPayment, refundPayment);

// Create PayMongo payment intent (client only)
router.post('/paymongo/intent', restrictTo('CLIENT'), createPaymentIntent);

export default router;