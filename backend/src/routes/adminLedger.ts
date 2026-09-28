import { Router } from 'express';
import {
  getLedgerStatus,
  openLedgerAdmin,
  syncFeesAdmin,
  getReconciliation,
  signOffReconciliation,
  listLedgerTransactions,
} from '../controllers/adminLedgerController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/status', getLedgerStatus);
router.post('/open', openLedgerAdmin);
router.post('/sync-fees', syncFeesAdmin);
router.get('/reconciliation', getReconciliation);
router.post('/reconciliation', signOffReconciliation);
router.get('/transactions', listLedgerTransactions);

export default router;
