import { Router } from 'express';
import {
  createPayment,
  getPaymentDetail,
  listMyPayments,
  releaseEscrow,
  refundPayment,
  createPaymongoCheckout,
  handlePayMongoWebhook,
  handlePaymongoTransferWebhook,
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

// PayMongo transfer (disbursement) callback (no auth required — signature-verified)
router.post('/paymongo/transfers/callback', handlePaymongoTransferWebhook);

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

// Create PayMongo Source checkout (GCash/Maya) for an existing pending payment (client only)
router.post('/:bookingId/paymongo/checkout', restrictTo('CLIENT'), createPaymongoCheckout);

export default router;