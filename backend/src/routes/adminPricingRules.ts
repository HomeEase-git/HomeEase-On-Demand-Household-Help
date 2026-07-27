import { Router } from 'express';
import {
  listPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
} from '../controllers/pricingRuleController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listPricingRules);
router.post('/', createPricingRule);
router.patch('/:id', updatePricingRule);
router.delete('/:id', deletePricingRule);

export default router;
