import { Router } from 'express';
import {
  createPayment,
  getPaymentDetail,
  listMyPayments,
  releaseEscrow,
  refundPayment,
  createXenditCheckout,
  handleXenditInvoiceWebhook,
  handleXenditPayoutWebhook,
} from '../controllers/paymentController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import {
  validateReleaseEscrow,
  validateRefundPayment,
} from '../middleware/validation';

const router = Router();

// Xendit invoice-paid webhook (no auth required — token-verified)
router.post('/xendit/invoice-webhook', handleXenditInvoiceWebhook);

// Xendit payout status webhook (no auth required — token-verified)
router.post('/xendit/payout-webhook', handleXenditPayoutWebhook);

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

// Create Xendit Invoice checkout (GCash/Maya) for an existing pending payment (client only)
router.post('/:bookingId/xendit/checkout', restrictTo('CLIENT'), createXenditCheckout);

export default router;
