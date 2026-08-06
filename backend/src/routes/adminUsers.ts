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
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/clients', listClients);
router.get('/clients/:id', getClientById);
router.get('/workers', listWorkers);
router.get('/workers/:id', getWorkerById);
router.patch('/:id/status', updateUserStatus);
router.patch('/:id/suspend', suspendUser);
router.patch('/:id/reinstate', reinstateUser);

export default router;
