import type { Booking, BookingStatus, Dispute, Prisma } from '@prisma/client';
import prisma from '@config/database';
import { notifyUser } from '@utils/notify';
import { formatDisplayId } from '@utils/formatters';
import { BookingStatusConflictError, lockBooking, updateBookingIfStatus } from '@services/bookingStatusWrite';

async function lockInStatus(tx: Prisma.TransactionClient, bookingId: string, allowed: readonly BookingStatus[]) {
  const booking = await lockBooking(tx, bookingId);
  if (!booking || !allowed.includes(booking.status)) throw new BookingStatusConflictError(bookingId, allowed);
}

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

export async function openBookingDispute({
  bookingId,
  raisedById,
  reason,
  allowedStatuses,
}: {
  bookingId: string;
  raisedById: string;
  reason: string;
  allowedStatuses: readonly BookingStatus[];
}): Promise<Dispute | null> {
  const dispute = await prisma.$transaction((tx) => createDisputeTx(tx, bookingId, raisedById, reason, allowedStatuses));
  if (dispute) await notifyAdminsOfDispute(dispute);
  return dispute;
}

export async function escalateCancelRequest(booking: Booking, why: 'DECLINED' | 'NO_ANSWER'): Promise<void> {
  const workerDid = why === 'DECLINED' ? 'declined' : "didn't answer";
  const dispute = await prisma.$transaction(async (tx) => {
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
