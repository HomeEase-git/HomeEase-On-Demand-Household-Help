import { Worker, type Job } from 'bullmq';
import prisma from '@config/database';
import { redisConnection as connection } from '@config/redis';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import { BOOKING_QUEUE_NAME, JOB_NAMES, type ExpirePendingBookingJobData } from '@queues/bookingQueue';
import { freeSlot } from '@services/workerAvailabilityService';
import { refundOrVoidPayment, captureAndReleasePayment } from '@services/paymentLifecycleService';

/**
 * A PENDING booking that no worker responded to within an hour is
 * auto-cancelled: escrow is voided/refunded, the assigned worker's slot (if
 * any) is freed, and a Cancellation record captures why.
 */
async function expirePendingBooking(data: ExpirePendingBookingJobData): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: data.bookingId } });
  if (!booking || booking.status !== 'PENDING') return; // already resolved by accept/decline/cancel

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED' },
    });

    await tx.cancellation.create({
      data: {
        bookingId: booking.id,
        cancelledBy: 'WORKER',
        cancelledById: booking.workerId ?? 'system',
        reason: 'WORKER_NO_RESPONSE',
      },
    });

    if (booking.workerId && booking.timeSlot) {
      const workerProfile = await tx.workerProfile.findUnique({
        where: { userId: booking.workerId },
        select: { id: true },
      });
      if (workerProfile) {
        await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot);
      }
    }
  });

  await refundOrVoidPayment(booking.id, 'WORKER_NO_RESPONSE').catch((error) => {
    console.error(`Failed to void payment for expired booking ${booking.id}:`, error);
  });

  await notifyUser({
    userId: booking.clientId,
    type: 'BOOKING_CANCELLED',
    title: 'Booking Expired',
    message: 'No worker responded in time, so this booking was cancelled and your payment hold was released.',
    relatedId: booking.id,
  });

  await writeAuditLog({
    action: 'BOOKING_EXPIRED',
    category: 'STATUS_CHANGE',
    message: `Booking ${booking.id} auto-cancelled after 1 hour with no worker response`,
    metadata: { bookingId: booking.id, workerId: booking.workerId },
  });
}

/**
 * Bookings that reached COMPLETED but still have escrow HELD 24h later
 * (client never explicitly confirmed, or confirmation failed to release
 * payment) are auto-settled so a worker's payout isn't stuck indefinitely.
 */
async function autoSettleCompletedBookings(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stale = await prisma.booking.findMany({
    where: {
      status: 'COMPLETED',
      updatedAt: { lte: cutoff },
      payment: { escrowStatus: 'HELD' },
    },
    include: { payment: true },
  });

  for (const booking of stale) {
    if (!booking.payment) continue;
    const finalAmount = booking.finalPrice ?? booking.payment.subtotal;

    try {
      await captureAndReleasePayment(booking.id, finalAmount, booking.workerId);
      await writeAuditLog({
        action: 'BOOKING_AUTO_SETTLED',
        category: 'STATUS_CHANGE',
        message: `Booking ${booking.id} escrow auto-released after 24h without client confirmation`,
        metadata: { bookingId: booking.id },
      });
    } catch (error) {
      console.error(`Failed to auto-settle booking ${booking.id}:`, error);
    }
  }
}

/**
 * Clears stale isBooked flags on past-dated WorkerAvailability rows. A slot
 * can be left marked isBooked if a booking concluded through a path that
 * didn't explicitly free it (defense-in-depth self-heal, not the primary
 * mechanism — accept/complete/cancel free their own slot inline).
 */
async function resetExpiredAvailabilitySlots(): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const staleSlots = await prisma.workerAvailability.findMany({
    where: { date: { lt: today }, isBooked: true },
    include: { workerProfile: { select: { userId: true } } },
  });

  const ACTIVE_STATUSES = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED', 'DISPUTED'] as const;

  for (const slot of staleSlots) {
    const stillActive = await prisma.booking.findFirst({
      where: {
        workerId: slot.workerProfile.userId,
        scheduledDate: slot.date,
        timeSlot: slot.timeSlot,
        status: { in: [...ACTIVE_STATUSES] },
      },
      select: { id: true },
    });

    if (!stillActive) {
      await prisma.workerAvailability.update({
        where: { id: slot.id },
        data: { isBooked: false },
      });
    }
  }
}

export async function startBookingWorker() {
  const worker = new Worker(
    BOOKING_QUEUE_NAME,
    async (job: Job) => {
      switch (job.name) {
        case JOB_NAMES.EXPIRE_PENDING:
          await expirePendingBooking(job.data as ExpirePendingBookingJobData);
          break;
        case JOB_NAMES.AUTO_SETTLE_COMPLETED:
          await autoSettleCompletedBookings();
          break;
        case JOB_NAMES.RESET_AVAILABILITY:
          await resetExpiredAvailabilitySlots();
          break;
        default:
          console.warn(`Unknown booking queue job: ${job.name}`);
      }
      return { success: true };
    },
    { connection }
  );

  worker.on('failed', (job, err) => {
    console.error(`Booking queue job ${job?.name}#${job?.id} failed`, err);
  });

  return worker;
}
