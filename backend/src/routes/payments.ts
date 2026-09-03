import { Router } from 'express';
import {
  getPaymentDetail,
  listMyPayments,
  refundPayment,
  createXenditCheckout,
  handleXenditInvoiceWebhook,
  handleXenditPayoutWebhook,
} from '../controllers/paymentController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import { validateRefundPayment } from '../middleware/validation';

const router = Router();

// Xendit invoice-paid webhook (no auth required — token-verified)
router.post('/xendit/invoice-webhook', handleXenditInvoiceWebhook);

// Xendit payout status webhook (no auth required — token-verified)
router.post('/xendit/payout-webhook', handleXenditPayoutWebhook);

// All other routes require auth
router.use(authMiddleware);

// List my payments (client: payments made, worker: payouts)
router.get('/', listMyPayments);

// Get payment detail
router.get('/:bookingId', getPaymentDetail);

// Request a refund (client only) — voids an unpaid payment, or opens a dispute
// for a completed one
router.post('/:id/refund', restrictTo('CLIENT'), validateRefundPayment, refundPayment);

// Resume the Xendit checkout for a GCash/Maya booking that is AWAITING_PAYMENT
// (client only)
router.post('/:bookingId/xendit/checkout', restrictTo('CLIENT'), createXenditCheckout);

export default router;
