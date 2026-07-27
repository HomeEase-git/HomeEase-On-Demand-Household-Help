import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', getSettings);
router.put('/', updateSettings);

export default router;
