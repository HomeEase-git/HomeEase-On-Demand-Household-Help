import { Router } from 'express';
import { getDisputeForParty } from '../controllers/disputeController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/:id', getDisputeForParty);

export default router;
