import { Router } from 'express';
import {
  listClients,
  getClientById,
  listWorkers,
  getWorkerById,
  updateUserStatus,
  suspendUser,
  reinstateUser,
} from '../controllers/adminUserController';
import { getWorkerWalletAdmin, adjustWorkerWalletAdmin } from '../controllers/walletController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/clients', listClients);
router.get('/clients/:id', getClientById);
router.get('/workers', listWorkers);
router.get('/workers/:id', getWorkerById);
router.get('/workers/:id/wallet', getWorkerWalletAdmin);
router.patch('/workers/:id/wallet/adjust', adjustWorkerWalletAdmin);
router.patch('/:id/status', updateUserStatus);
router.patch('/:id/suspend', suspendUser);
router.patch('/:id/reinstate', reinstateUser);

export default router;
