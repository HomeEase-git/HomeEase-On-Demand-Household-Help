import type { Booking, Prisma } from '@prisma/client';
import { updateBookingIfStatus } from '@services/bookingStatusWrite';
import { requestRefund } from '@services/refundRequestService';
import { cancelPendingExpiryJob } from '@queues/bookingQueue';

/**
 * The shared writes of cancelling a booking, inside the caller's transaction.
 * Throws BookingStatusConflictError if the status moved since `booking` was
 * read, so nothing below runs. Returns the reloaded booking and the
 * assigned worker's profile id (null when there's no worker or profile).
 */
export async function finalizeCancellationTx(
  tx: Prisma.TransactionClient,
  booking: Booking,
  cancelledByRole: 'CLIENT' | 'WORKER' | 'ADMIN',
  cancellation: Omit<Prisma.CancellationUncheckedCreateInput, 'bookingId'>,
  notes?: string | null
): Promise<{ booking: Booking; workerProfileId: string | null }> {
  const id = booking.id;

  // Claim the transition first: if the status moved since the read above
  // (accept, expiry, completion), nothing below runs. The UPDATE also
  // holds the row lock until commit.
  await updateBookingIfStatus(tx, id, booking.status, {
    status: 'CANCELLED',
    notes, // schema has no cancelReason; kept as the canceller's own free-text reason
  });

  // Free up the worker's active-job count for any pre-completion status.
  // A DISPUTED booking can also be reached post-completion
  // (AWAITING_PAYMENT -> DISPUTED) where completeBooking already freed
  // it — workerCompletedAt distinguishes that case.
  const workerProfile = booking.workerId
    ? await tx.workerProfile.findUnique({ where: { userId: booking.workerId }, select: { id: true } })
    : null;
  if (
    workerProfile &&
    !booking.workerCompletedAt &&
    ['ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED', 'DISPUTED'].includes(booking.status)
  ) {
    await tx.workerProfile.update({
      where: { id: workerProfile.id },
      data: { activeJobCount: { decrement: 1 } },
    });
  }

  await tx.bookingVisit.updateMany({
    where: { bookingId: id, status: 'SCHEDULED' },
    data: { status: 'CANCELLED' },
  });

  // A booking cancelled outside dispute resolution ends whatever dispute
  // was open on it — otherwise it lingers in the admin queue.
  await tx.dispute.updateMany({
    where: { bookingId: id, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    data: {
      status: 'RESOLVED_DISMISSED',
      resolution: `Booking was cancelled by the ${cancelledByRole.toLowerCase()} before this dispute was resolved`,
      resolvedAt: new Date(),
    },
  });

  await tx.cancellation.create({ data: { ...cancellation, bookingId: id } });

  return { booking: await tx.booking.findUniqueOrThrow({ where: { id } }), workerProfileId: workerProfile?.id ?? null };
}

/** Best-effort follow-ups once the cancellation has committed. */
export async function afterCancellation(bookingId: string, reason: string, requestedById?: string): Promise<void> {
  await cancelPendingExpiryJob(bookingId).catch((error) => {
    console.error('Failed to cancel pending-expiry job for cancelled booking %s:', bookingId, error);
  });
  await requestRefund({
    bookingId,
    reason,
    source: 'BOOKING_CANCELLED',
    requestedById,
  }).catch((error) => {
    console.error('Failed to void/refund-request payment for cancelled booking %s:', bookingId, error);
  });
}
