import { Router } from 'express';
import {
  getPaymentDetail,
  listMyPayments,
  refundPayment,
  createXenditCheckout,
  createDuesCheckout,
  handleXenditInvoiceWebhook,
  handleXenditPayoutWebhook,
} from '../controllers/paymentController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import { validateRefundPayment } from '../middleware/validation';

const router = Router();

router.post('/xendit/invoice-webhook', handleXenditInvoiceWebhook);

router.post('/xendit/payout-webhook', handleXenditPayoutWebhook);

// All other routes require auth
router.use(authMiddleware);

router.get('/', listMyPayments);

router.post('/dues', restrictTo('WORKER'), createDuesCheckout);

// Get payment detail
router.get('/:bookingId', getPaymentDetail);

router.post('/:id/refund', restrictTo('CLIENT'), validateRefundPayment, refundPayment);

router.post('/:bookingId/xendit/checkout', restrictTo('CLIENT'), createXenditCheckout);

export default router;
