import prisma from '@config/database';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[.+\]$/;

type SendPushInput = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

/**
 * Sends a remote push notification to a user's registered device via Expo's
 * push HTTP API (https://exp.host/--/api/v2/push/send), so notifications
 * reach a user even while the app is closed or backgrounded (in-app delivery
 * via Socket.IO only reaches an open app). Called with a single recipient at
 * a time, so this skips the expo-server-sdk package entirely — its main
 * value (batching many recipients into chunks) doesn't apply here, and it
 * ships ESM-only, which fights this project's CommonJS/ts-jest test setup.
 * Best-effort: swallows all errors so a push failure never breaks the
 * caller's main flow (notification creation already succeeded by this point).
 */
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
      }),
      // This runs fire-and-forget off the main request path (see notify.ts),
      // but an unbounded call still leaks a pending connection if Expo's
      // service is slow/unreachable — bound it defensively.
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
