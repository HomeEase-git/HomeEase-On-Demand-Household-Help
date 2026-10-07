import { Router } from 'express';
import { listBlocks, blockUser, unblockUser } from '../controllers/blockController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', listBlocks);
router.post('/:userId', blockUser);
router.delete('/:userId', unblockUser);

export default router;
