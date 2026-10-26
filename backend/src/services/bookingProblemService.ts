import type { Booking, Dispute, Prisma } from '@prisma/client';
import prisma from '@config/database';
import { notifyUser } from '@utils/notify';
import { formatDisplayId } from '@utils/formatters';
import { lockBooking, updateBookingIfStatus } from '@services/bookingStatusWrite';

/**
 * Creates an OPEN dispute inside the caller's transaction, or returns null
 * when one is already open or under review. Takes the booking row lock so
 * two racing reports open only one.
 */
async function createDisputeTx(
  tx: Prisma.TransactionClient,
  bookingId: string,
  raisedById: string,
  reason: string
): Promise<Dispute | null> {
  await lockBooking(tx, bookingId);
  const existing = await tx.dispute.findFirst({
    where: { bookingId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    select: { id: true },
  });
  if (existing) return null;
  return tx.dispute.create({ data: { bookingId, raisedById, reason, status: 'OPEN' } });
}

/** Tells every admin about a newly opened dispute (after it has committed). */
async function notifyAdminsOfDispute(dispute: Dispute): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
  await Promise.all(
    admins.map((admin) =>
      notifyUser({
        userId: admin.id,
        type: 'DISPUTE_OPENED',
        title: 'Problem reported',
        message: `Booking ${formatDisplayId(dispute.bookingId)}: ${dispute.reason}`,
        relatedId: dispute.id,
      })
    )
  );
}

/**
 * Opens an OPEN dispute on a pre-invoice booking and tells every admin.
 * Returns null when one is already open or under review.
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
  const dispute = await prisma.$transaction((tx) => createDisputeTx(tx, bookingId, raisedById, reason));
  if (dispute) await notifyAdminsOfDispute(dispute);
  return dispute;
}

/**
 * The worker declined (or never answered) the client's cancel request, so an
 * admin decides: marks the request escalated and opens a dispute in one
 * transaction (a failure leaves it unescalated, so a retry or the sweep can
 * try again), then tells the admins and the client.
 */
export async function escalateCancelRequest(booking: Booking, why: 'DECLINED' | 'NO_ANSWER'): Promise<void> {
  const workerDid = why === 'DECLINED' ? 'declined' : "didn't answer";
  const dispute = await prisma.$transaction(async (tx) => {
    // Guarded so a double tap (or the no-answer sweep racing a decline)
    // escalates once; the loser gets BookingStatusConflictError.
    await updateBookingIfStatus(
      tx,
      booking.id,
      ['ACCEPTED', 'IN_PROGRESS'],
      { cancelRequestEscalatedAt: new Date() },
      { cancelRequestEscalatedAt: null }
    );
    return createDisputeTx(
      tx,
      booking.id,
      booking.clientId,
      `Client asked to cancel (${booking.cancelRequestReason ?? 'no reason given'}); worker ${workerDid}`
    );
  });
  if (dispute) await notifyAdminsOfDispute(dispute);

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
