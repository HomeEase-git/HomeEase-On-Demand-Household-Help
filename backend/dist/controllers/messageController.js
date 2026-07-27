"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUnreadCount = exports.markConversationRead = exports.sendMessage = exports.getConversationThread = exports.getConversations = void 0;
const database_1 = __importDefault(require("@config/database"));
const errorResponse_1 = require("@utils/errorResponse");
const notify_1 = require("@utils/notify");
const socket_1 = require("../socket");
/**
 * GET /api/messages/conversations
 * Get derived conversation list (latest message from each unique sender/receiver pair)
 */
const getConversations = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { page = '1', limit = '10' } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
        const skip = (pageNum - 1) * limitNum;
        // Capture userId to avoid repeated req.user narrowing issues inside callbacks
        const currentUserId = req.user.userId;
        // Get all messages for this user (either sender or receiver)
        const messages = await database_1.default.message.findMany({
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
        const conversationMap = new Map();
        messages.forEach((msg) => {
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
    }
    catch (error) {
        console.error('Error fetching conversations:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch conversations'));
    }
};
exports.getConversations = getConversations;
/**
 * GET /api/messages/conversations/:userId
 * Get message thread with one specific user
 */
const getConversationThread = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const otherUserId = req.params.userId; // cast: params are always string
        const { page = '1', limit = '50' } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
        const skip = (pageNum - 1) * limitNum;
        const currentUserId = req.user.userId;
        const [messages, total] = await Promise.all([
            database_1.default.message.findMany({
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
            database_1.default.message.count({
                where: {
                    OR: [
                        { senderId: currentUserId, receiverId: otherUserId },
                        { senderId: otherUserId, receiverId: currentUserId },
                    ],
                },
            }),
        ]);
        // Mark all received messages in this thread as read
        await database_1.default.message.updateMany({
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
    }
    catch (error) {
        console.error('Error fetching conversation thread:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to fetch conversation thread'));
    }
};
exports.getConversationThread = getConversationThread;
/**
 * POST /api/messages
 * Send a message (also creates MESSAGE_RECEIVED Notification)
 */
const sendMessage = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const { receiverId, content, imageUrl } = req.body;
        const currentUserId = req.user.userId;
        // Verify receiver exists
        const receiver = await database_1.default.user.findUnique({
            where: { id: receiverId },
        });
        if (!receiver) {
            return res.status(404).json((0, errorResponse_1.errorResponse)(404, 'Receiver not found'));
        }
        const message = await database_1.default.message.create({
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
        await (0, notify_1.notifyUser)({
            userId: receiverId,
            type: 'MESSAGE_RECEIVED',
            title: `Message from ${message.sender.fullName}`,
            message: imageUrl ? '📷 Sent an image' : content.substring(0, 100),
            relatedId: message.id,
        });
        // Push the new message live to the receiver, if connected
        try {
            (0, socket_1.getIO)().to(receiverId).emit('message:new', message);
        }
        catch {
            // Socket.IO may not be initialized (e.g. scripts/tests) — safe to ignore
        }
        return res.status(201).json({
            success: true,
            message: 'Message sent successfully',
            data: message,
        });
    }
    catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to send message'));
    }
};
exports.sendMessage = sendMessage;
/**
 * PATCH /api/messages/conversations/:userId/read
 * Mark entire conversation with a user as read
 */
const markConversationRead = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const otherUserId = req.params.userId;
        const currentUserId = req.user.userId;
        const result = await database_1.default.message.updateMany({
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
    }
    catch (error) {
        console.error('Error marking conversation as read:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to mark conversation as read'));
    }
};
exports.markConversationRead = markConversationRead;
/**
 * GET /api/messages/unread-count
 * Get total unread message count for the badge
 */
const getUnreadCount = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json((0, errorResponse_1.errorResponse)(401, 'Not authenticated'));
        }
        const unreadCount = await database_1.default.message.count({
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
    }
    catch (error) {
        console.error('Error getting unread count:', error);
        return res.status(500).json((0, errorResponse_1.errorResponse)(500, 'Failed to get unread count'));
    }
};
exports.getUnreadCount = getUnreadCount;
//# sourceMappingURL=messageController.js.map