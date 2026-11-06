import prisma from '@config/database';
import { getAppSettings } from '@services/appSettingsService';
import { expirePendingBooking } from '@workers/bookingWorker';

export async function expireOverduePendingBookings(): Promise<{ expired: number; checked: number }> {
  const { pendingExpiryMinutes } = await getAppSettings();

  const pending = await prisma.booking.findMany({
    where: { status: 'PENDING' },
    select: { id: true, createdAt: true },
  });

  const now = Date.now();
  let expired = 0;

  for (const booking of pending) {
    const minutes = Math.max(1, Math.round(pendingExpiryMinutes));
    const deadline = booking.createdAt.getTime() + minutes * 60 * 1000;
    if (now < deadline) continue;

    try {
      await expirePendingBooking({ bookingId: booking.id });
      expired++;
    } catch (error) {
      console.error(`Failed to expire overdue pending booking ${booking.id}:`, error);
    }
  }

  return { expired, checked: pending.length };
}
