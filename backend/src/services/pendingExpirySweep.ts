import prisma from '@config/database';
import { getAppSettings } from '@services/appSettingsService';
import { EXPIRY_MULTIPLIER } from '@queues/bookingQueue';
import { expirePendingBooking } from '@workers/bookingWorker';

/**
 * Cron-callable equivalent of bookingQueue's per-booking delayed
 * EXPIRE_PENDING job. That job only fires if the in-process BullMQ worker is
 * actually running when its delay elapses — fine normally, but a host that
 * sleeps on idle (Render's free tier) takes the worker down with it, so a
 * booking sitting PENDING while the service is asleep never gets expired on
 * schedule. This sweep finds every PENDING booking whose urgency-scaled
 * expiry window has already passed and expires it through the exact same
 * expirePendingBooking() the queue uses, so the two paths can't drift.
 *
 * Safe to call from BullMQ's own tick too (it's a superset, idempotent —
 * expirePendingBooking no-ops on a booking already moved on) but it's meant
 * for /internal/cron, hit hourly by a GitHub Actions workflow on hosts
 * without a reliably-alive worker.
 */
export async function expireOverduePendingBookings(): Promise<{ expired: number; checked: number }> {
  const { pendingExpiryMinutes } = await getAppSettings();

  const pending = await prisma.booking.findMany({
    where: { status: 'PENDING' },
    select: { id: true, createdAt: true, urgencyLevel: true },
  });

  const now = Date.now();
  let expired = 0;

  for (const booking of pending) {
    const minutes = Math.max(1, Math.round(pendingExpiryMinutes * EXPIRY_MULTIPLIER[booking.urgencyLevel]));
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
