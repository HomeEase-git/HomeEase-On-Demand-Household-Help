import { Worker, type Job } from 'bullmq';
import prisma from '@config/database';
import { redisConnection as connection } from '@config/redis';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { writeAuditLog } from '@utils/auditLog';
import { BOOKING_QUEUE_NAME, JOB_NAMES, type ExpirePendingBookingJobData } from '@queues/bookingQueue';
import { freeSlot } from '@services/workerAvailabilityService';
import {
  refundOrVoidPayment,
  settleCashBooking,
  settleWorkerEarnings,
  reconcilePendingPayment,
} from '@services/paymentLifecycleService';
import { retrievePayout } from '@services/xenditDisbursementService';
import { schedulePayout } from '@queues/payoutQueue';
import { formatDisplayId } from '@utils/formatters';

const HOUR_MS = 60 * 60 * 1000;
const COMPLETION_REMINDER_HOURS = 12;
const COMPLETION_AUTO_CONFIRM_HOURS = 24;
// A GCash/Maya booking the client confirmed but never paid (or never even
// confirmed) is escalated to an admin dispute after this long. No platform
// money is fronted — the worker is simply not paid until it clears.
const PAYMENT_OVERDUE_DISPUTE_HOURS = 72;
// Reconcile a payment/payout that's been mid-flight longer than this against
// Xendit directly, in case a webhook was missed.
const RECONCILE_AFTER_HOURS = 1;
const QUOTE_REMINDER_HOURS = 12;
const QUOTE_AUTO_APPROVE_HOURS = 24;

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
  void sendSmsToUser({
    userId: booking.clientId,
    message: 'HomeEase: No worker responded in time, so your booking was cancelled and your payment hold was released.',
  });

  await writeAuditLog({
    action: 'BOOKING_EXPIRED',
    category: 'STATUS_CHANGE',
    message: `Booking ${booking.id} auto-cancelled after 1 hour with no worker response`,
    metadata: { bookingId: booking.id, workerId: booking.workerId },
  });
}

/** Opens an OPEN dispute for an unpaid/unconfirmed job and pings every admin. */
async function escalateOverduePayment(booking: { id: string; clientId: string; workerId: string | null }): Promise<void> {
  const existing = await prisma.dispute.findFirst({
    where: { bookingId: booking.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
  });
  if (existing) return;

  const dispute = await prisma.dispute.create({
    data: {
      bookingId: booking.id,
      raisedById: booking.workerId ?? 'system',
      reason: 'Payment overdue — the client has not paid for a completed job',
      status: 'OPEN',
    },
  });

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
  await Promise.all(
    admins.map((admin) =>
      notifyUser({
        userId: admin.id,
        type: 'PAYMENT_REFUNDED',
        title: 'Payment Overdue',
        message: `Booking ${formatDisplayId(booking.id)} has been awaiting client payment for over ${PAYMENT_OVERDUE_DISPUTE_HOURS}h.`,
        relatedId: dispute.id,
      })
    )
  );

  await writeAuditLog({
    action: 'PAYMENT_OVERDUE_ESCALATED',
    category: 'STATUS_CHANGE',
    level: 'WARN',
    message: `Booking ${booking.id} auto-escalated to a dispute after ${PAYMENT_OVERDUE_DISPUTE_HOURS}h unpaid`,
    metadata: { bookingId: booking.id, disputeId: dispute.id },
  });
}

/**
 * Post-completion payment safety net (pay-after-completion model).
 *
 *  - PENDING_COMPLETION 12h  -> nudge the client to confirm.
 *  - PENDING_COMPLETION 24h + CASH -> auto-confirm: the client is assumed to
 *    have paid the worker in person, so the booking is finalized and the
 *    platform's cut is accrued as worker commission debt (settleCashBooking).
 *  - PENDING_COMPLETION / AWAITING_PAYMENT 72h + GCash/Maya -> escalate to an
 *    admin dispute. No auto-complete, no platform funds fronted.
 *  - Reconciliation: PENDING payments / PROCESSING payouts older than 1h are
 *    re-checked against Xendit in case a webhook was missed.
 *  - Self-heal: COMPLETED bookings whose worker payout never got created.
 */
async function remindAndAutoSettleCompletions(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - COMPLETION_REMINDER_HOURS * HOUR_MS);
  const autoConfirmCutoff = new Date(now - COMPLETION_AUTO_CONFIRM_HOURS * HOUR_MS);
  const overdueCutoff = new Date(now - PAYMENT_OVERDUE_DISPUTE_HOURS * HOUR_MS);
  const reconcileCutoff = new Date(now - RECONCILE_AFTER_HOURS * HOUR_MS);

  // 1. 12h reminder — worker submitted a photo, client hasn't confirmed/paid.
  const needsReminder = await prisma.booking.findMany({
    where: {
      status: { in: ['PENDING_COMPLETION', 'AWAITING_PAYMENT'] },
      workerCompletedAt: { lte: reminderCutoff },
      completionReminderSentAt: null,
    },
  });
  for (const booking of needsReminder) {
    await notifyUser({
      userId: booking.clientId,
      type: 'COMPLETION_REMINDER',
      title: 'Please confirm and pay for your completed job',
      message: 'Your worker marked this job done — review the photo, confirm, and complete payment.',
      relatedId: booking.id,
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { completionReminderSentAt: new Date() },
    });
  }

  // 2. CASH PENDING_COMPLETION past 24h -> auto-confirm (cash assumed collected).
  const staleCash = await prisma.booking.findMany({
    where: {
      status: 'PENDING_COMPLETION',
      workerCompletedAt: { lte: autoConfirmCutoff },
      OR: [{ paymentMethodType: 'CASH' }, { paymentMethodType: null }],
    },
  });
  for (const booking of staleCash) {
    try {
      await settleCashBooking(booking.id);
      await notifyUser({
        userId: booking.clientId,
        type: 'BOOKING_AUTO_COMPLETED',
        title: 'Booking Auto-Completed',
        message: "You didn't confirm in time, so this cash booking was automatically marked complete.",
        relatedId: booking.id,
      });
      if (booking.workerId) {
        await notifyUser({
          userId: booking.workerId,
          type: 'BOOKING_AUTO_COMPLETED',
          title: 'Job Auto-Completed',
          message: 'The client did not confirm in time, so this cash job was auto-completed.',
          relatedId: booking.id,
        });
      }
      await writeAuditLog({
        action: 'BOOKING_AUTO_SETTLED',
        category: 'STATUS_CHANGE',
        message: `Cash booking ${booking.id} auto-completed after 24h without client confirmation`,
        metadata: { bookingId: booking.id },
      });
    } catch (error) {
      console.error(`Failed to auto-settle cash booking ${booking.id}:`, error);
    }
  }

  // 3. GCash/Maya jobs unpaid 72h+ -> escalate to an admin dispute.
  const overdueOnline = await prisma.booking.findMany({
    where: {
      status: { in: ['PENDING_COMPLETION', 'AWAITING_PAYMENT'] },
      workerCompletedAt: { lte: overdueCutoff },
      paymentMethodType: { in: ['GCASH', 'MAYA'] },
    },
    select: { id: true, clientId: true, workerId: true },
  });
  for (const booking of overdueOnline) {
    try {
      await escalateOverduePayment(booking);
    } catch (error) {
      console.error(`Failed to escalate overdue payment for booking ${booking.id}:`, error);
    }
  }

  // 4. Reconcile PENDING payments against Xendit (missed invoice-paid webhook).
  const stalePendingPayments = await prisma.payment.findMany({
    where: { status: 'PENDING', xenditInvoiceId: { not: null }, createdAt: { lte: reconcileCutoff } },
    select: { id: true },
  });
  for (const payment of stalePendingPayments) {
    try {
      const result = await reconcilePendingPayment(payment.id);
      if (result !== 'pending') {
        await writeAuditLog({
          action: 'PAYMENT_RECONCILED',
          category: 'STATUS_CHANGE',
          message: `Payment ${payment.id} reconciled from Xendit as ${result} (webhook likely missed)`,
          metadata: { paymentId: payment.id, result },
        });
      }
    } catch (error) {
      console.error(`Failed to reconcile pending payment ${payment.id}:`, error);
    }
  }

  // 5. Reconcile PROCESSING payouts against Xendit (missed payout webhook).
  const staleProcessingPayouts = await prisma.payout.findMany({
    where: { status: 'PROCESSING', processingAt: { lte: reconcileCutoff }, xenditDisbursementId: { not: null } },
    select: { id: true, xenditDisbursementId: true, workerId: true, amount: true },
  });
  for (const payout of staleProcessingPayouts) {
    try {
      const remote = await retrievePayout(payout.xenditDisbursementId as string);
      const status = remote.status?.toUpperCase();
      if (status === 'COMPLETED' || status === 'SUCCEEDED') {
        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: 'PAID', xenditStatus: remote.status, paidAt: new Date() },
        });
      } else if (status === 'FAILED') {
        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: 'FAILED', xenditStatus: remote.status, failureReason: 'Xendit reported failure', failedAt: new Date() },
        });
      }
    } catch (error) {
      console.error(`Failed to reconcile processing payout ${payout.id}:`, error);
    }
  }

  // 6. Re-enqueue PENDING payouts whose BullMQ enqueue never landed (jobId
  //    dedup makes a re-add harmless).
  const unqueuedPayouts = await prisma.payout.findMany({
    where: { status: 'PENDING', createdAt: { lte: reconcileCutoff } },
    select: { id: true },
  });
  for (const payout of unqueuedPayouts) {
    try {
      await schedulePayout(payout.id);
    } catch (error) {
      console.error(`Failed to re-enqueue pending payout ${payout.id}:`, error);
    }
  }

  // 7. Self-heal: a COMPLETED payment whose worker earnings were never settled
  //    (e.g. finalizePaidBooking threw right after marking the payment paid).
  const paidButUnsettled = await prisma.payment.findMany({
    where: {
      status: 'COMPLETED',
      workerSettledAt: null,
      updatedAt: { lte: reconcileCutoff },
    },
    select: { id: true },
  });
  for (const payment of paidButUnsettled) {
    try {
      await settleWorkerEarnings(payment.id);
    } catch (error) {
      console.error(`Failed to self-heal unsettled earnings for payment ${payment.id}:`, error);
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
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: 'QUOTE_APPROVED',
          quoteStatus: 'APPROVED',
          approvedAt: new Date(),
          finalPrice: booking.laborCost! + booking.materialsCost!,
        },
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
