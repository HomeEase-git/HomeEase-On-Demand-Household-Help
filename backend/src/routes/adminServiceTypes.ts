import { Router } from 'express';
import {
  listServiceTypesAdmin,
  createServiceType,
  updateServiceType,
  toggleServiceTypeActive,
} from '../controllers/adminServiceTypeController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listServiceTypesAdmin);
router.post('/', createServiceType);
router.patch('/:id', updateServiceType);
router.patch('/:id/toggle-active', toggleServiceTypeActive);

export default router;
