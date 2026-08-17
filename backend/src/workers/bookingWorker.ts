import { Worker, type Job } from 'bullmq';
import prisma from '@config/database';
import { redisConnection as connection } from '@config/redis';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import { BOOKING_QUEUE_NAME, JOB_NAMES, type ExpirePendingBookingJobData } from '@queues/bookingQueue';
import { freeSlot } from '@services/workerAvailabilityService';
import { refundOrVoidPayment, captureAndReleasePayment } from '@services/paymentLifecycleService';

const HOUR_MS = 60 * 60 * 1000;
const COMPLETION_REMINDER_HOURS = 12;
const COMPLETION_AUTO_CONFIRM_HOURS = 24;
const QUOTE_REMINDER_HOURS = 12;
const QUOTE_AUTO_APPROVE_HOURS = 24;

const round2 = (n: number): number => Math.round(n * 100) / 100;

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
 * Client-confirmation safety net for PENDING_COMPLETION bookings (worker
 * submitted a completion photo, awaiting the client's confirm-completion
 * tap): a 12h reminder nudges the client, and if they still haven't acted
 * by 24h the booking auto-completes and escrow releases to the worker — an
 * unresponsive client can't leave a worker unpaid indefinitely. Also
 * retries release for the rare edge case of a booking that already reached
 * COMPLETED (confirmCompletion's status update) but whose payment capture
 * — a separate step right after, in the same request — threw.
 */
async function remindAndAutoSettleCompletions(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - COMPLETION_REMINDER_HOURS * HOUR_MS);
  const autoConfirmCutoff = new Date(now - COMPLETION_AUTO_CONFIRM_HOURS * HOUR_MS);

  const needsReminder = await prisma.booking.findMany({
    where: {
      status: 'PENDING_COMPLETION',
      workerCompletedAt: { lte: reminderCutoff },
      completionReminderSentAt: null,
    },
  });

  for (const booking of needsReminder) {
    await notifyUser({
      userId: booking.clientId,
      type: 'COMPLETION_REMINDER',
      title: 'Please confirm your completed job',
      message: 'Your worker marked this job done — review the photo and confirm so their payment can be released.',
      relatedId: booking.id,
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { completionReminderSentAt: new Date() },
    });
  }

  const stalePendingCompletion = await prisma.booking.findMany({
    where: {
      status: 'PENDING_COMPLETION',
      workerCompletedAt: { lte: autoConfirmCutoff },
    },
    include: { addOns: true },
  });

  for (const booking of stalePendingCompletion) {
    try {
      const addonsCost = booking.addOns.reduce((sum, addon) => sum + addon.price, 0);
      const hasQuote = booking.laborCost != null && booking.materialsCost != null;
      const finalPrice = round2(
        hasQuote ? (booking.laborCost ?? 0) + (booking.materialsCost ?? 0) + addonsCost : booking.estimatedPrice + addonsCost
      );

      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'COMPLETED', finalPrice, completionDate: new Date() },
      });

      await captureAndReleasePayment(booking.id, finalPrice, booking.workerId);

      await notifyUser({
        userId: booking.clientId,
        type: 'BOOKING_AUTO_COMPLETED',
        title: 'Booking Auto-Completed',
        message: "You didn't confirm in time, so this booking was automatically marked complete and the worker was paid.",
        relatedId: booking.id,
      });
      if (booking.workerId) {
        await notifyUser({
          userId: booking.workerId,
          type: 'BOOKING_AUTO_COMPLETED',
          title: 'Payment Released',
          message: 'The client did not confirm in time, so this job was auto-completed and your payment was released.',
          relatedId: booking.id,
        });
      }

      await writeAuditLog({
        action: 'BOOKING_AUTO_SETTLED',
        category: 'STATUS_CHANGE',
        message: `Booking ${booking.id} auto-completed and escrow released after 24h without client confirmation`,
        metadata: { bookingId: booking.id },
      });
    } catch (error) {
      console.error(`Failed to auto-settle booking ${booking.id}:`, error);
    }
  }

  const staleCompletedUnreleased = await prisma.booking.findMany({
    where: {
      status: 'COMPLETED',
      updatedAt: { lte: autoConfirmCutoff },
      payment: { escrowStatus: 'HELD' },
    },
    include: { payment: true },
  });

  for (const booking of staleCompletedUnreleased) {
    if (!booking.payment) continue;
    const finalAmount = booking.finalPrice ?? booking.payment.subtotal;

    try {
      await captureAndReleasePayment(booking.id, finalAmount, booking.workerId);
      await writeAuditLog({
        action: 'BOOKING_AUTO_SETTLED',
        category: 'STATUS_CHANGE',
        message: `Booking ${booking.id} escrow auto-released after 24h stuck HELD post-completion`,
        metadata: { bookingId: booking.id },
      });
    } catch (error) {
      console.error(`Failed to auto-settle booking ${booking.id}:`, error);
    }
  }
}

/**
 * Client-approval safety net for QUOTE_SUBMITTED bookings — same shape as
 * remindAndAutoSettleCompletions but for the quote-approval step: a 12h
 * reminder, then an unresponsive client's quote auto-approves at 24h so a
 * worker who already did the job isn't stuck unable to complete it (and get
 * paid) because the client never opened the app.
 */
async function remindAndAutoApproveQuotes(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - QUOTE_REMINDER_HOURS * HOUR_MS);
  const autoApproveCutoff = new Date(now - QUOTE_AUTO_APPROVE_HOURS * HOUR_MS);

  const needsReminder = await prisma.booking.findMany({
    where: {
      status: 'QUOTE_SUBMITTED',
      quotedAt: { lte: reminderCutoff },
      quoteReminderSentAt: null,
    },
  });

  for (const booking of needsReminder) {
    await notifyUser({
      userId: booking.clientId,
      type: 'QUOTE_REMINDER',
      title: 'A quote is waiting for your approval',
      message: 'Your worker submitted a quote for this job — review and approve or dispute it.',
      relatedId: booking.id,
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { quoteReminderSentAt: new Date() },
    });
  }

  const staleQuotes = await prisma.booking.findMany({
    where: {
      status: 'QUOTE_SUBMITTED',
      quotedAt: { lte: autoApproveCutoff },
    },
  });

  for (const booking of staleQuotes) {
    if (booking.laborCost == null || booking.materialsCost == null) continue;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'QUOTE_APPROVED',
            quoteStatus: 'APPROVED',
            approvedAt: new Date(),
            finalPrice: booking.laborCost! + booking.materialsCost!,
          },
        });

        // Re-affirm the hold, same as the manual approveQuote path.
        await tx.payment.updateMany({
          where: { bookingId: booking.id, escrowStatus: { not: 'RELEASED' } },
          data: { escrowStatus: 'HELD' },
        });
      });

      if (booking.workerId) {
        await notifyUser({
          userId: booking.workerId,
          type: 'QUOTE_AUTO_APPROVED',
          title: 'Quote Auto-Approved',
          message: 'The client did not respond in time, so your quote was automatically approved. You can now complete the job.',
          relatedId: booking.id,
        });
      }
      await notifyUser({
        userId: booking.clientId,
        type: 'QUOTE_AUTO_APPROVED',
        title: 'Quote Auto-Approved',
        message: "You didn't respond in time, so the worker's quote was automatically approved.",
        relatedId: booking.id,
      });

      await writeAuditLog({
        action: 'QUOTE_AUTO_APPROVED',
        category: 'STATUS_CHANGE',
        message: `Booking ${booking.id} quote auto-approved after 24h without client response`,
        metadata: { bookingId: booking.id },
      });
    } catch (error) {
      console.error(`Failed to auto-approve quote for booking ${booking.id}:`, error);
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
          await remindAndAutoSettleCompletions();
          break;
        case JOB_NAMES.QUOTE_TIMEOUT_SWEEP:
          await remindAndAutoApproveQuotes();
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
