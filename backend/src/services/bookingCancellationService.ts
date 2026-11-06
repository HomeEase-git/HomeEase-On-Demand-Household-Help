import type { Booking, Prisma } from '@prisma/client';
import { updateBookingIfStatus } from '@services/bookingStatusWrite';
import { requestRefund } from '@services/refundRequestService';
import { cancelPendingExpiryJob } from '@queues/bookingQueue';

export async function finalizeCancellationTx(
  tx: Prisma.TransactionClient,
  booking: Booking,
  cancelledByRole: 'CLIENT' | 'WORKER' | 'ADMIN',
  cancellation: Omit<Prisma.CancellationUncheckedCreateInput, 'bookingId'>,
  notes?: string | null
): Promise<{ booking: Booking; workerProfileId: string | null }> {
  const id = booking.id;

  await updateBookingIfStatus(tx, id, booking.status, {
    status: 'CANCELLED',
    notes,
  });

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
