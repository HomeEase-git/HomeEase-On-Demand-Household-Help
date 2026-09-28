import { Router } from 'express';
import { getPriceList, updatePriceList } from '../controllers/adminPriceListController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', getPriceList);
router.patch('/', updatePriceList);

export default router;
