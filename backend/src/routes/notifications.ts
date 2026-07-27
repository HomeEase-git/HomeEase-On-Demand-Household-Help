import { Router } from 'express';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
} from '../controllers/notificationController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All notification routes require auth
router.use(authMiddleware);

// Get unread count (put before other routes to avoid route conflict)
router.get('/unread-count', getUnreadNotificationCount);

// Mark all as read
router.patch('/read-all', markAllNotificationsRead);

// Get paginated notifications
router.get('/', getNotifications);

// Mark a single notification as read
router.patch('/:id/read', markNotificationRead);

export default router;
