import { Router } from 'express';
import { listBookings, getBookingById, cancelBookingAdmin, setBookingArchived } from '../controllers/adminBookingController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listBookings);
router.get('/:id', getBookingById);
router.patch('/:id/cancel', cancelBookingAdmin);
router.patch('/:id/archive', setBookingArchived);

export default router;
