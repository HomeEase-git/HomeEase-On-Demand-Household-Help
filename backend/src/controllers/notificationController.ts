import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * GET /api/notifications
 * Get paginated notifications for the current user
 */
export const getNotifications = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.notification.count({ where: { userId: req.user.userId } }),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Notifications retrieved successfully',
      data: {
        notifications,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch notifications'));
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read
 */
export const markNotificationRead = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const id = req.params.id as string;

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification || notification.userId !== req.user.userId) {
      return res.status(404).json(errorResponse(404, 'Notification not found'));
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: updated,
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res.status(500).json(errorResponse(500, 'Failed to mark notification as read'));
  }
};

/**
 * PATCH /api/notifications/read-all
 * Mark all of the current user's notifications as read
 */
export const markAllNotificationsRead = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const result = await prisma.notification.updateMany({
      where: { userId: req.user.userId, isRead: false },
      data: { isRead: true },
    });

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      data: { updatedCount: result.count },
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return res.status(500).json(errorResponse(500, 'Failed to mark all notifications as read'));
  }
};

/**
 * GET /api/notifications/unread-count
 * Get total unread notification count for the badge
 */
export const getUnreadNotificationCount = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const unreadCount = await prisma.notification.count({
      where: { userId: req.user.userId, isRead: false },
    });

    return res.status(200).json({
      success: true,
      message: 'Unread count retrieved successfully',
      data: { unreadCount },
    });
  } catch (error) {
    console.error('Error getting unread notification count:', error);
    return res.status(500).json(errorResponse(500, 'Failed to get unread notification count'));
  }
};
