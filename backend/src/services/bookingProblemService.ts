import type { Booking, BookingStatus, Dispute, Prisma } from '@prisma/client';
import prisma from '@config/database';
import { notifyUser } from '@utils/notify';
import { formatDisplayId } from '@utils/formatters';
import { BookingStatusConflictError, lockBooking, updateBookingIfStatus } from '@services/bookingStatusWrite';

/**
 * Row-locks the booking until the transaction ends and throws
 * BookingStatusConflictError if it has moved out of `allowed` since the
 * caller read it (callers map that to 409).
 */
async function lockInStatus(tx: Prisma.TransactionClient, bookingId: string, allowed: readonly BookingStatus[]) {
  const booking = await lockBooking(tx, bookingId);
  if (!booking || !allowed.includes(booking.status)) throw new BookingStatusConflictError(bookingId, allowed);
}

/**
 * Creates an OPEN dispute inside the caller's transaction, or returns null
 * when one is already open or under review. Takes the booking row lock so
 * two racing reports open only one.
 */
async function createDisputeTx(
  tx: Prisma.TransactionClient,
  bookingId: string,
  raisedById: string,
  reason: string,
  allowedStatuses: readonly BookingStatus[]
): Promise<Dispute | null> {
  await lockInStatus(tx, bookingId, allowedStatuses);
  const existing = await tx.dispute.findFirst({
    where: { bookingId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    select: { id: true },
  });
  if (existing) return null;
  return tx.dispute.create({ data: { bookingId, raisedById, reason, status: 'OPEN' } });
}

/**
 * Opens an OPEN dispute inside the caller's transaction, or adds this report
 * to the one already open (a problem reported before the invoice), so a
 * booking never has two at once. Takes the booking row lock. A joined report
 * keeps the original raisedById, so its line is prefixed with who said it.
 */
export async function openOrJoinDisputeTx(
  tx: Prisma.TransactionClient,
  data: { bookingId: string; raisedById: string; reason: string; evidenceUrls?: string[] },
  opts: { allowedStatuses: readonly BookingStatus[]; raisedByRole: 'CLIENT' | 'WORKER' }
): Promise<Dispute> {
  await lockInStatus(tx, data.bookingId, opts.allowedStatuses);
  const existing = await tx.dispute.findFirst({ where: { bookingId: data.bookingId, status: { in: ['OPEN', 'UNDER_REVIEW'] } } });
  if (!existing) return tx.dispute.create({ data: { ...data, status: 'OPEN' } });
  return tx.dispute.update({
    where: { id: existing.id },
    data: {
      reason: `${existing.reason}\n[${opts.raisedByRole.toLowerCase()}] ${data.reason}`,
      evidenceUrls: { push: data.evidenceUrls ?? [] },
    },
  });
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
  allowedStatuses,
}: {
  bookingId: string;
  raisedById: string;
  reason: string;
  /** Statuses the caller read; a booking that moved since throws BookingStatusConflictError. */
  allowedStatuses: readonly BookingStatus[];
}): Promise<Dispute | null> {
  const dispute = await prisma.$transaction((tx) => createDisputeTx(tx, bookingId, raisedById, reason, allowedStatuses));
  if (dispute) await notifyAdminsOfDispute(dispute);
  return dispute;
}

/**
 * The worker declined (or never answered) the client's cancel request, so an
 * admin decides: marks the request escalated and opens a dispute (or adds
 * the request to the one already open) in one transaction (a failure leaves it unescalated, so a retry or the sweep can
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
    return openOrJoinDisputeTx(
      tx,
      {
        bookingId: booking.id,
        raisedById: booking.clientId,
        reason: `Client asked to cancel (${booking.cancelRequestReason ?? 'no reason given'}); worker ${workerDid}`,
      },
      { allowedStatuses: ['ACCEPTED', 'IN_PROGRESS'], raisedByRole: 'CLIENT' }
    );
  });
  await notifyAdminsOfDispute(dispute);

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
