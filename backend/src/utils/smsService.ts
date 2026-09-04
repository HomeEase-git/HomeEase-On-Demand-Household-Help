import prisma from '@config/database';

// PhilSMS (https://app.philsms.com) — PH-local SMS gateway. Auth is a bearer
// API token from Account > API Documents; sender ID is the alphanumeric name
// (max 11 chars) shown as the "from" on the recipient's phone.
const PHILSMS_API_URL = 'https://app.philsms.com/api/v3/sms/send';
const PHILSMS_API_TOKEN = process.env.PHILSMS_API_TOKEN?.trim();
const PHILSMS_SENDER_ID = process.env.PHILSMS_SENDER_ID || 'HomeEase';

/**
 * Normalizes a PH mobile number into the "63XXXXXXXXXX" format PhilSMS
 * expects, regardless of how it was entered (09171234567, +63 917 123 4567,
 * 639171234567, with spaces/dashes, etc).
 */
const normalizePhPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('63')) return digits;
  if (digits.startsWith('0')) return `63${digits.slice(1)}`;
  return `63${digits}`;
};

const send = async (phone: string, message: string, label: string): Promise<void> => {
  if (!PHILSMS_API_TOKEN) {
    throw new Error('PHILSMS_API_TOKEN must be set to send SMS');
  }

  const recipient = normalizePhPhone(phone);

  try {
    const response = await fetch(PHILSMS_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PHILSMS_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        recipient,
        sender_id: PHILSMS_SENDER_ID,
        type: 'plain',
        message,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`PhilSMS responded ${response.status}: ${JSON.stringify(result)}`);
    }

    console.log(`[SMS] ${label} sent to ${recipient}`);
  } catch (err) {
    console.error(`[SMS] Failed to send ${label}:`, err);
    throw new Error(`Failed to send ${label}: ${(err as Error).message}`);
  }
};

/** Sends a 6-digit OTP by SMS — the PhilSMS equivalent of sendOtpEmail. */
export const sendOtpSms = async (phone: string, otp: string): Promise<void> => {
  await send(phone, `Your HomeEase verification code is ${otp}. This code expires in 10 minutes.`, 'OTP SMS');
};

type SendSmsToUserInput = {
  userId: string;
  message: string;
};

/**
 * Best-effort SMS to a user's phone on file, looked up by userId. Mirrors
 * sendPushToUser's contract: fire-and-forget, swallows all errors (including
 * a missing phone number) so a failed/skipped SMS never breaks the caller's
 * main flow. Reserved for time-critical, low-frequency events (e.g. a worker
 * accepting a booking) — unlike push, each send has a real per-message cost,
 * so this should NOT be wired into every notifyUser() call.
 */
export const sendSmsToUser = async ({ userId, message }: SendSmsToUserInput): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });

    const phone = user?.phone;
    if (!phone) return;

    await send(phone, message, 'notification SMS');
  } catch (error) {
    console.error(`[SMS] Unexpected error sending notification SMS to user ${userId}:`, error);
  }
};
