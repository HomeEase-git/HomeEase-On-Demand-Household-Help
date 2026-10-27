import type { NotificationType } from '@prisma/client';
import prisma from '@config/database';
import { getIO } from '../socket';
import { sendPushToUser } from '../services/pushNotificationService';

type NotifyUserInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedId?: string;
};

/**
 * Creates a Notification row and pushes it live to the target user's socket
 * room, if connected. Centralizes what used to be scattered
 * `prisma.notification.create` calls across booking/payment/message flows.
 * Never throws (returns null if the row can't be saved): callers notify after
 * their action has committed, and a lost notification mustn't turn that into
 * a 500.
 */
export const notifyUser = async (input: NotifyUserInput) => {
  let notification;
  try {
    notification = await prisma.notification.create({ data: input });
  } catch (error) {
    console.error(`Failed to save a ${input.type} notification for user ${input.userId}:`, error);
    return null;
  }

  try {
    getIO().to(input.userId).emit('notification:new', notification);
  } catch {
    // Socket.IO may not be initialized (e.g. scripts/tests) — notification is
    // still persisted, so this is safe to swallow.
  }

  // Fire-and-forget — reaches the user even if the app is closed/backgrounded,
  // unlike the socket emit above which only reaches an open app. Never awaited
  // so a slow/failed push can't delay the caller's response.
  void sendPushToUser({
    userId: input.userId,
    title: input.title,
    body: input.message,
    // relatedId (usually a booking id) lets a tap open the right screen directly.
    data: { notificationId: notification.id, type: input.type, ...(input.relatedId ? { relatedId: input.relatedId } : {}) },
  });

  return notification;
};
