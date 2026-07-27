import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { getIO } from '../socket';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * GET /api/messages/conversations
 * Get derived conversation list (latest message from each unique sender/receiver pair)
 */
export const getConversations = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { page = '1', limit = '10' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Capture userId to avoid repeated req.user narrowing issues inside callbacks
    const currentUserId = req.user.userId;

    // Get all messages for this user (either sender or receiver)
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId },
          { receiverId: currentUserId },
        ],
      },
      include: {
        sender: {
          select: { id: true, fullName: true, avatar: true, phone: true }, // schema field is `avatar`, not `profileImage`
        },
        receiver: {
          select: { id: true, fullName: true, avatar: true, phone: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by conversation (sender/receiver pair)
    const conversationMap = new Map<string, any>();

    messages.forEach((msg: any) => {
      const key = [currentUserId, msg.senderId === currentUserId ? msg.receiverId : msg.senderId]
        .sort()
        .join('_');

      if (!conversationMap.has(key)) {
        const otherUser = msg.senderId === currentUserId ? msg.receiver : msg.sender;
        conversationMap.set(key, {
          userId: otherUser.id,
          userName: otherUser.fullName,
          userImage: otherUser.avatar,
          userPhone: otherUser.phone,
          lastMessage: msg.content,
          lastMessageTime: msg.createdAt,
          unreadCount: !msg.isRead && msg.receiverId === currentUserId ? 1 : 0,
        });
      }
    });

    // Convert to array and paginate
    let conversations = Array.from(conversationMap.values());
    const total = conversations.length;
    conversations = conversations.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      message: 'Conversations retrieved successfully',
      data: {
        conversations,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch conversations'));
  }
};

/**
 * GET /api/messages/conversations/:userId
 * Get message thread with one specific user
 */
export const getConversationThread = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const otherUserId = req.params.userId as string; // cast: params are always string
    const { page = '1', limit = '50' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 50));
    const skip = (pageNum - 1) * limitNum;

    const currentUserId = req.user.userId;

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: {
          OR: [
            { senderId: currentUserId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: currentUserId },
          ],
        },
        include: {
          sender: {
            select: { id: true, fullName: true, avatar: true, phone: true },
          },
          receiver: {
            select: { id: true, fullName: true, avatar: true, phone: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.message.count({
        where: {
          OR: [
            { senderId: currentUserId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: currentUserId },
          ],
        },
      }),
    ]);

    // Mark all received messages in this thread as read
    await prisma.message.updateMany({
      where: {
        receiverId: currentUserId, // string — no ambiguity
        senderId: otherUserId,
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });

    return res.status(200).json({
      success: true,
      message: 'Thread retrieved successfully',
      data: {
        messages: messages.reverse(), // chronological order
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching conversation thread:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch conversation thread'));
  }
};

/**
 * POST /api/messages
 * Send a message (also creates MESSAGE_RECEIVED Notification)
 */
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const { receiverId, content, imageUrl } = req.body;
    const currentUserId = req.user.userId;

    // Verify receiver exists
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
    });

    if (!receiver) {
      return res.status(404).json(errorResponse(404, 'Receiver not found'));
    }

    const message = await prisma.message.create({
      data: {
        senderId: currentUserId,
        receiverId,
        content: content ?? '',
        imageUrl: imageUrl ?? null,
        isRead: false,
      },
      include: {
        sender: {
          select: { id: true, fullName: true, avatar: true, phone: true },
        },
        receiver: {
          select: { id: true, fullName: true, avatar: true, phone: true },
        },
      },
    });

    // Create notification for receiver and push it live
    await notifyUser({
      userId: receiverId,
      type: 'MESSAGE_RECEIVED',
      title: `Message from ${message.sender.fullName}`,
      message: imageUrl ? '📷 Sent an image' : content.substring(0, 100),
      relatedId: message.id,
    });

    // Push the new message live to the receiver, if connected
    try {
      getIO().to(receiverId).emit('message:new', message);
    } catch {
      // Socket.IO may not be initialized (e.g. scripts/tests) — safe to ignore
    }

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: message,
    });
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json(errorResponse(500, 'Failed to send message'));
  }
};

/**
 * PATCH /api/messages/conversations/:userId/read
 * Mark entire conversation with a user as read
 */
export const markConversationRead = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const otherUserId = req.params.userId as string;
    const currentUserId = req.user.userId;

    const result = await prisma.message.updateMany({
      where: {
        receiverId: currentUserId,
        senderId: otherUserId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Conversation marked as read',
      data: {
        updatedCount: result.count,
      },
    });
  } catch (error) {
    console.error('Error marking conversation as read:', error);
    return res.status(500).json(errorResponse(500, 'Failed to mark conversation as read'));
  }
};

/**
 * GET /api/messages/unread-count
 * Get total unread message count for the badge
 */
export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    const unreadCount = await prisma.message.count({
      where: {
        receiverId: req.user.userId,
        isRead: false,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Unread count retrieved successfully',
      data: {
        unreadCount,
      },
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    return res.status(500).json(errorResponse(500, 'Failed to get unread count'));
  }
};