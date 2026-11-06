import prisma from '@config/database';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[.+\]$/;

type SendPushInput = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const CHANNEL_FOR_TYPE: Record<string, string> = {
  BOOKING_REQUEST: 'new-job',
  MESSAGE_RECEIVED: 'messages',
  BOOKING_ACCEPTED: 'bookings',
};

type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

export async function sendPushToUser({ userId, title, body, data }: SendPushInput): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    });

    const pushToken = user?.pushToken;
    if (!pushToken) return;

    if (!EXPO_PUSH_TOKEN_PATTERN.test(pushToken)) {
      console.warn(`[Push] Stored token for user ${userId} is not a valid Expo push token — clearing it`);
      await prisma.user.update({ where: { id: userId }, data: { pushToken: null } });
      return;
    }

    const response = await fetch(EXPO_PUSH_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        data: data ?? {},
        sound: 'default',
        ...channelFor(data),
      }),
      signal: AbortSignal.timeout(10000),
    });

    const result = (await response.json()) as { data?: ExpoPushTicket };
    const ticket = result.data;

    if (ticket?.status === 'error') {
      console.error(`[Push] Failed to send to user ${userId}:`, ticket.message, ticket.details);
      if (ticket.details?.error === 'DeviceNotRegistered') {
        await prisma.user.update({ where: { id: userId }, data: { pushToken: null } });
      }
    }
  } catch (error) {
    console.error(`[Push] Unexpected error sending push to user ${userId}:`, error);
  }
}

function channelFor(data: Record<string, unknown> | undefined): { channelId?: string } {
  const channelId = typeof data?.type === 'string' ? CHANNEL_FOR_TYPE[data.type] : undefined;
  return channelId ? { channelId } : {};
}
