import { Router } from 'express';
import {
  getConversations,
  getConversationThread,
  sendMessage,
  markConversationRead,
  getUnreadCount,
  reportMessage,
} from '../controllers/messageController';
import { chatImageUpload, uploadChatImage } from '../controllers/uploadController';
import { authMiddleware } from '../middleware/auth';
import { validateSendMessage, validateReportMessage } from '../middleware/validation';

const router = Router();

// All message routes require auth
router.use(authMiddleware);

router.get('/unread-count', getUnreadCount);

// Get all conversations
router.get('/conversations', getConversations);

// Get specific conversation thread
router.get('/conversations/:userId', getConversationThread);

// Mark conversation as read
router.patch('/conversations/:userId/read', markConversationRead);

// Upload a chat image attachment
router.post('/upload-image', chatImageUpload, uploadChatImage);

// Send message
router.post('/', validateSendMessage, sendMessage);

router.post('/:id/report', validateReportMessage, reportMessage);

export default router;
