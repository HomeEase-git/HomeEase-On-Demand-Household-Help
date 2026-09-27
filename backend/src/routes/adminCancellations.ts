import { Router } from 'express';
import { listCancellationReviews, reviewCancellation } from '../controllers/adminCancellationController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

// On-site cancellations where the worker blamed the client and attached proof.
router.get('/', listCancellationReviews);
router.patch('/:bookingId/review', reviewCancellation);

export default router;
