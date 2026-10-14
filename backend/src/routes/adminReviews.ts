import { Router } from 'express';
import { listReviews, getReviewById, updateReview, warnReviewAuthor } from '../controllers/adminReviewController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listReviews);
router.get('/:id', getReviewById);
router.patch('/:id', updateReview);
router.post('/:id/warn', warnReviewAuthor);

export default router;
