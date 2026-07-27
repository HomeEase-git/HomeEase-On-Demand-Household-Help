"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const messageController_1 = require("../controllers/messageController");
const uploadController_1 = require("../controllers/uploadController");
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const router = (0, express_1.Router)();
// All message routes require auth
router.use(auth_1.authMiddleware);
// Get unread count (put before other routes to avoid route conflict)
router.get('/unread-count', messageController_1.getUnreadCount);
// Get all conversations
router.get('/conversations', messageController_1.getConversations);
// Get specific conversation thread
router.get('/conversations/:userId', messageController_1.getConversationThread);
// Mark conversation as read
router.patch('/conversations/:userId/read', messageController_1.markConversationRead);
// Upload a chat image attachment
router.post('/upload-image', uploadController_1.chatImageUpload, uploadController_1.uploadChatImage);
// Send message
router.post('/', validation_1.validateSendMessage, messageController_1.sendMessage);
exports.default = router;
//# sourceMappingURL=messages.js.map