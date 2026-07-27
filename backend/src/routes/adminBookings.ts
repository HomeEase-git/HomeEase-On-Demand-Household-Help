import { Router } from 'express';
import { listBookings, getBookingById } from '../controllers/adminBookingController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listBookings);
router.get('/:id', getBookingById);

export default router;
