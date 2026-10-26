import type { Booking, Dispute } from '@prisma/client';
import prisma from '@config/database';
import { notifyUser } from '@utils/notify';
import { formatDisplayId } from '@utils/formatters';
import { lockBooking, updateBookingIfStatus } from '@services/bookingStatusWrite';

/**
 * Opens an OPEN dispute on a pre-invoice booking and tells every admin.
 * Returns null when one is already open or under review. The booking row
 * lock makes two racing reports open only one.
 */
export async function openBookingDispute({
  bookingId,
  raisedById,
  reason,
}: {
  bookingId: string;
  raisedById: string;
  reason: string;
}): Promise<Dispute | null> {
  const dispute = await prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    const existing = await tx.dispute.findFirst({
      where: { bookingId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      select: { id: true },
    });
    if (existing) return null;
    return tx.dispute.create({ data: { bookingId, raisedById, reason, status: 'OPEN' } });
  });
  if (!dispute) return null;

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
  await Promise.all(
    admins.map((admin) =>
      notifyUser({
        userId: admin.id,
        type: 'DISPUTE_OPENED',
        title: 'Problem reported',
        message: `Booking ${formatDisplayId(bookingId)}: ${reason}`,
        relatedId: dispute.id,
      })
    )
  );
  return dispute;
}

/**
 * The worker declined (or never answered) the client's cancel request, so an
 * admin decides: marks the request escalated, opens a dispute, tells the client.
 */
export async function escalateCancelRequest(booking: Booking, why: 'DECLINED' | 'NO_ANSWER'): Promise<void> {
  // Guarded so a double tap (or the no-answer sweep racing a decline)
  // escalates once; the loser gets BookingStatusConflictError.
  await updateBookingIfStatus(
    prisma,
    booking.id,
    ['ACCEPTED', 'IN_PROGRESS'],
    { cancelRequestEscalatedAt: new Date() },
    { cancelRequestEscalatedAt: null }
  );

  const workerDid = why === 'DECLINED' ? 'declined' : "didn't answer";
  await openBookingDispute({
    bookingId: booking.id,
    raisedById: booking.clientId,
    reason: `Client asked to cancel (${booking.cancelRequestReason ?? 'no reason given'}); worker ${workerDid}`,
  });

  await notifyUser({
    userId: booking.clientId,
    type: 'BOOKING_PROBLEM_REPORTED',
    title: 'HomeEase will decide',
    message:
      why === 'DECLINED'
        ? "Your worker didn't agree to cancel, so HomeEase will decide. We'll tell you the outcome."
        : "Your worker didn't answer, so HomeEase will decide. We'll tell you the outcome.",
    relatedId: booking.id,
  });
}
