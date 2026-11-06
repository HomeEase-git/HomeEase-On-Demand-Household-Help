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

export const notifyUser = async (input: NotifyUserInput) => {
  let notification;
  try {
    notification = await prisma.notification.create({ data: input });
  } catch (error) {
    console.error('Failed to save a %s notification for user %s:', input.type, input.userId, error);
    return null;
  }

  try {
    getIO().to(input.userId).emit('notification:new', notification);
  } catch {
  }

  void sendPushToUser({
    userId: input.userId,
    title: input.title,
    body: input.message,
    data: { notificationId: notification.id, type: input.type, ...(input.relatedId ? { relatedId: input.relatedId } : {}) },
  });

  return notification;
};
