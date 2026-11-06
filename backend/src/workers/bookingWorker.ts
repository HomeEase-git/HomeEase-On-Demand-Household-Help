import { Worker, type Job } from 'bullmq';
import type { Booking } from '@prisma/client';
import prisma from '@config/database';
import { workerConnection as connection } from '@config/redis';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { writeAuditLog } from '@utils/auditLog';
import { requestRefund } from '@services/refundRequestService';
import { BOOKING_QUEUE_NAME, JOB_NAMES, type ExpirePendingBookingJobData } from '@queues/bookingQueue';
import { bookingStartInstant, phTodayStart } from '@services/workerAvailabilityService';
import { chargePenaltyTx } from '@services/debtLedgerService';
import { reconcileStalePendingDebtPayments } from '@services/debtPaymentService';
import { updateBookingIfStatus, isBookingStatusConflict } from '@services/bookingStatusWrite';
import { getAppSettings } from '@services/appSettingsService';
import {
  settleCashBooking,
  settleWorkerEarnings,
  reconcilePendingPayment,
  reconcilePendingRefund,
} from '@services/paymentLifecycleService';
import { retrievePayout, findLivePayoutByReference } from '@services/xenditDisbursementService';
import { applyXenditPayoutStatus } from '@services/payoutStatusService';
import { schedulePayout } from '@queues/payoutQueue';
import { formatDisplayId } from '@utils/formatters';
import { revokeUserSessions } from '@utils/tokenRevocation';
import { revokeAllRefreshTokens } from '@utils/otpService';
import { JWT_EXPIRY } from '@utils/jwt';
import { purgeExpiredData } from '@services/dataRetentionService';
import { escalateCancelRequest } from '@services/bookingProblemService';

const HOUR_MS = 60 * 60 * 1000;
const COMPLETION_REMINDER_HOURS = 12;
const PAYMENT_REMINDER_HOURS = 2;
const CASH_AUTO_SETTLE_HOURS = 72;
const CASH_SECOND_REMINDER_HOURS = 48;
const PAYMENT_OVERDUE_DISPUTE_HOURS = 72;
const RECONCILE_AFTER_HOURS = 1;
const RESCHEDULE_REMINDER_HOURS = 12;
const RESCHEDULE_AUTO_CONFIRM_HOURS = 24;
const RESCHEDULE_REQUEST_REMINDER_HOURS = 24;
const RESCHEDULE_REQUEST_AUTO_DECLINE_HOURS = 48;
// Stuck-booking sweep (see nudgeStuckBookings).
const CANCEL_REQUEST_TIMEOUT_HOURS = 2;
const CANCEL_REQUEST_MIN_ANSWER_MINUTES = 15;
const START_REMINDER_MINUTES = 30;
const START_NUDGE_HOURS = 2;
const PROGRESS_REMINDER_HOURS = 12;
const PROGRESS_ESCALATE_HOURS = 48;

export async function expirePendingBooking(data: ExpirePendingBookingJobData): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: data.bookingId } });
  if (!booking || booking.status !== 'PENDING') return; // already resolved by accept/decline/cancel

  try {
    await prisma.$transaction(async (tx) => {
      await updateBookingIfStatus(tx, booking.id, 'PENDING', { status: 'CANCELLED' });

      await tx.cancellation.create({
        data: {
          bookingId: booking.id,
          cancelledBy: 'WORKER',
          cancelledById: booking.workerId ?? 'system',
          reason: 'WORKER_NO_RESPONSE',
        },
      });
    });
  } catch (error) {
    if (isBookingStatusConflict(error)) return; // accept/decline/cancel won the race
    throw error;
  }

  await requestRefund({ bookingId: booking.id, reason: 'WORKER_NO_RESPONSE', source: 'BOOKING_CANCELLED' }).catch((error) => {
    console.error(`Failed to void/refund-request payment for expired booking ${booking.id}:`, error);
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
        type: 'DISPUTE_OPENED',
        title: 'Payment Overdue',
        message: `Booking ${formatDisplayId(booking.id)} has been awaiting client payment for over ${PAYMENT_OVERDUE_DISPUTE_HOURS}h.`,
        relatedId: dispute.id,
      })
    )
  );

  await notifyUser({
    userId: booking.clientId,
    type: 'DISPUTE_OPENED',
    title: 'Payment overdue — dispute opened',
    message: `Your payment for a completed booking is over ${PAYMENT_OVERDUE_DISPUTE_HOURS}h overdue, so it's been escalated to our support team for review.`,
    relatedId: dispute.id,
  });
  if (booking.workerId) {
    await notifyUser({
      userId: booking.workerId,
      type: 'DISPUTE_OPENED',
      title: 'Payment overdue — dispute opened',
      message: `Booking ${formatDisplayId(booking.id)} still hasn't been paid after ${PAYMENT_OVERDUE_DISPUTE_HOURS}h, so we've escalated it to our support team to chase it up.`,
      relatedId: dispute.id,
    });
  }

  await writeAuditLog({
    action: 'PAYMENT_OVERDUE_ESCALATED',
    category: 'STATUS_CHANGE',
    level: 'WARN',
    message: `Booking ${booking.id} auto-escalated to a dispute after ${PAYMENT_OVERDUE_DISPUTE_HOURS}h unpaid`,
    metadata: { bookingId: booking.id, disputeId: dispute.id },
  });
}

export async function remindAndAutoSettleCompletions(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - COMPLETION_REMINDER_HOURS * HOUR_MS);
  const paymentReminderCutoff = new Date(now - PAYMENT_REMINDER_HOURS * HOUR_MS);
  const overdueCutoff = new Date(now - PAYMENT_OVERDUE_DISPUTE_HOURS * HOUR_MS);
  const reconcileCutoff = new Date(now - RECONCILE_AFTER_HOURS * HOUR_MS);
  const cashSettleCutoff = new Date(now - CASH_AUTO_SETTLE_HOURS * HOUR_MS);

  const needsReminder = await prisma.booking.findMany({
    where: {
      status: { in: ['PENDING_COMPLETION', 'AWAITING_PAYMENT'] },
      workerCompletedAt: { lte: reminderCutoff },
      completionReminderSentAt: null,
    },
  });
  for (const booking of needsReminder) {
    const isCash = (booking.paymentMethodType ?? 'CASH') === 'CASH';
    await notifyUser({
      userId: booking.clientId,
      type: 'COMPLETION_REMINDER',
      title: 'Your invoice is still unpaid',
      message: isCash
        ? 'Your worker finished this job. Pay them in cash, or report the invoice in the app if something is wrong.'
        : 'Your worker finished this job. Open the booking to pay, or report the invoice if something is wrong.',
      relatedId: booking.id,
    });
    if (isCash && booking.workerId) {
      await notifyUser({
        userId: booking.workerId,
        type: 'COMPLETION_REMINDER',
        title: 'Did you get the cash?',
        message: `If the client paid you for booking ${formatDisplayId(booking.id)}, open the job and tap Cash received.`,
        relatedId: booking.id,
      });
    }
    await prisma.booking.update({
      where: { id: booking.id },
      data: { completionReminderSentAt: new Date() },
    });
  }

  const secondReminderCutoff = new Date(now - CASH_SECOND_REMINDER_HOURS * HOUR_MS);
  const needsSecondReminder = await prisma.booking.findMany({
    where: {
      status: 'PENDING_COMPLETION',
      OR: [{ paymentMethodType: 'CASH' }, { paymentMethodType: null }],
      workerCompletedAt: { lte: secondReminderCutoff, gt: cashSettleCutoff },
      disputeResolvedAt: null,
      disputes: { none: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
      cashSecondReminderSentAt: null,
    },
  });
  for (const booking of needsSecondReminder) {
    try {
      const claimed = await prisma.booking.updateMany({
        where: {
          id: booking.id,
          status: 'PENDING_COMPLETION',
          disputeResolvedAt: null,
          disputes: { none: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
          cashSecondReminderSentAt: null,
        },
        data: { cashSecondReminderSentAt: new Date() },
      });
      if (claimed.count !== 1) continue;
      await notifyUser({
        userId: booking.clientId,
        type: 'COMPLETION_REMINDER',
        title: 'Your invoice is still unpaid',
        message: 'Your cash invoice is still open. It will be recorded as paid in 1 day unless you report it.',
        relatedId: booking.id,
      });
      if (booking.workerId) {
        await notifyUser({
          userId: booking.workerId,
          type: 'COMPLETION_REMINDER',
          title: 'Did you get the cash?',
          message: `If the client paid you for booking ${formatDisplayId(booking.id)}, open the job and tap Cash received.`,
          relatedId: booking.id,
        });
      }
    } catch (error) {
      console.error(`Failed to send the second cash reminder for booking ${booking.id}:`, error);
    }
  }

  const needsPaymentReminder = await prisma.booking.findMany({
    where: {
      status: 'AWAITING_PAYMENT',
      awaitingPaymentSince: { lte: paymentReminderCutoff },
      paymentReminderSentAt: null,
    },
  });
  for (const booking of needsPaymentReminder) {
    await notifyUser({
      userId: booking.clientId,
      type: 'PAYMENT_REMINDER',
      title: "You're almost done — payment pending",
      message: 'Finish paying for your completed job so the worker can be paid out.',
      relatedId: booking.id,
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentReminderSentAt: new Date() },
    });
  }

  const staleCash = await prisma.booking.findMany({
    where: {
      status: 'PENDING_COMPLETION',
      OR: [{ paymentMethodType: 'CASH' }, { paymentMethodType: null }],
      workerCompletedAt: { lte: cashSettleCutoff },
      disputeResolvedAt: null,
      disputes: { none: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
    },
  });
  for (const booking of staleCash) {
    try {
      await settleCashBooking(booking.id, ['PENDING_COMPLETION']);
      await notifyUser({
        userId: booking.clientId,
        type: 'BOOKING_AUTO_COMPLETED',
        title: 'Your job is done',
        message: 'We recorded your cash payment to your worker. If you did not pay, contact support.',
        relatedId: booking.id,
      });
      if (booking.workerId) {
        await notifyUser({
          userId: booking.workerId,
          type: 'BOOKING_AUTO_COMPLETED',
          title: 'Cash payment recorded',
          message: `You didn't tap Cash received for booking ${formatDisplayId(booking.id)} within ${CASH_AUTO_SETTLE_HOURS} hours, so we recorded it as paid. If the client didn't pay, contact support.`,
          relatedId: booking.id,
        });
      }
      await writeAuditLog({
        action: 'BOOKING_AUTO_SETTLED',
        category: 'STATUS_CHANGE',
        message: `Cash booking ${booking.id} recorded as paid ${CASH_AUTO_SETTLE_HOURS}h after the invoice, with no Cash received or report`,
        metadata: { bookingId: booking.id },
      });
    } catch (error) {
      console.error(`Failed to auto-settle cash booking ${booking.id}:`, error);
    }
  }

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

  for (const { debtPaymentId, result } of await reconcileStalePendingDebtPayments(reconcileCutoff)) {
    await writeAuditLog({
      action: 'DUES_PAYMENT_RECONCILED',
      category: 'STATUS_CHANGE',
      message: `Dues payment ${debtPaymentId} reconciled from Xendit as ${result} (webhook likely missed)`,
      metadata: { debtPaymentId, result },
    });
  }

  const pendingRefunds = await prisma.payment.findMany({
    where: { xenditRefundStatus: 'PENDING', xenditRefundId: { not: null }, refundedAt: { lte: reconcileCutoff } },
    select: { id: true },
  });
  for (const payment of pendingRefunds) {
    try {
      await reconcilePendingRefund(payment.id);
    } catch (error) {
      console.error(`Failed to reconcile pending refund for payment ${payment.id}:`, error);
    }
  }

  const staleProcessingPayouts = await prisma.payout.findMany({
    where: { status: 'PROCESSING', processingAt: { lte: reconcileCutoff }, xenditDisbursementId: { not: null } },
    select: { id: true, xenditDisbursementId: true, workerId: true, bookingId: true, amount: true, channel: true },
  });
  for (const payout of staleProcessingPayouts) {
    try {
      const remote = await retrievePayout(payout.xenditDisbursementId as string);
      await applyXenditPayoutStatus(payout, remote.status);
    } catch (error) {
      console.error(`Failed to reconcile processing payout ${payout.id}:`, error);
    }
  }

  const orphanedPayouts = await prisma.payout.findMany({
    where: { status: 'PROCESSING', processingAt: { lte: reconcileCutoff }, xenditDisbursementId: null },
    select: { id: true, workerId: true, bookingId: true, amount: true, channel: true, xenditDisbursementId: true },
  });
  for (const payout of orphanedPayouts) {
    try {
      const remote = await findLivePayoutByReference(payout.id);
      if (remote) {
        await applyXenditPayoutStatus(payout, remote.status, { xenditDisbursementId: remote.id });
      } else {
        await prisma.payout.updateMany({
          where: { id: payout.id, status: 'PROCESSING', xenditDisbursementId: null },
          data: { status: 'PENDING', failureReason: 'Recovered after an interrupted send' },
        });
      }
      await writeAuditLog({
        action: 'PAYOUT_RECOVERED',
        category: 'STATUS_CHANGE',
        level: 'WARN',
        message: `Payout ${payout.id} was stuck PROCESSING without a Xendit id — ${remote ? `adopted Xendit payout ${remote.id}` : 'reset to PENDING for resend'}`,
        metadata: { payoutId: payout.id, bookingId: payout.bookingId, xenditDisbursementId: remote?.id ?? null },
      });
    } catch (error) {
      console.error(`Failed to recover orphaned payout ${payout.id}:`, error);
    }
  }

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

export async function cancelWorkerNoShows(): Promise<void> {
  const { noShowGraceMinutes, noShowPenaltyAmount } = await getAppSettings();
  const now = new Date();

  const candidates = await prisma.booking.findMany({
    where: {
      status: 'ACCEPTED',
      workerArrivedAt: null,
      scheduledDate: { lte: phTodayStart(now) },
    },
  });

  for (const booking of candidates) {
    const deadline = new Date(bookingStartInstant(booking).getTime() + noShowGraceMinutes * 60 * 1000);
    if (now < deadline || !booking.workerId) continue;

    try {
      await cancelAsWorkerNoShow(booking, { noShowGraceMinutes, noShowPenaltyAmount }, now);
    } catch (error) {
      console.error(`Failed to cancel worker no-show booking ${booking.id}:`, error);
    }
  }
}

export async function nudgeStuckBookings(now = new Date()): Promise<void> {
  const MIN_MS = 60 * 1000;
  const due = (clock: Date, ms: number) => now.getTime() >= clock.getTime() + ms;
  const remind = (userId: string, bookingId: string, title: string, message: string) =>
    notifyUser({ userId, type: 'BOOKING_REMINDER', title, message, relatedId: bookingId });
  const claim = async (b: { id: string; status: Booking['status'] }, column: 'startReminderSentAt' | 'startNudgeSentAt' | 'progressReminderSentAt' | 'progressEscalatedAt') =>
    (await prisma.booking.updateMany({ where: { id: b.id, status: b.status, [column]: null }, data: { [column]: now } })).count === 1;

  const OPEN_DISPUTE = { status: { in: ['OPEN', 'UNDER_REVIEW'] } };
  const NUDGE_FIELDS = {
    id: true,
    status: true,
    clientId: true,
    workerId: true,
    scheduledDate: true,
    scheduledTime: true,
    timeSlot: true,
    cancelRequestedAt: true,
    cancelRequestEscalatedAt: true,
  } as const;
  const clientIsBeingHelped = (b: { disputes: unknown[]; cancelRequestedAt: Date | null; cancelRequestEscalatedAt: Date | null }) =>
    b.disputes.length > 0 || (b.cancelRequestedAt != null && b.cancelRequestEscalatedAt == null);

  // 1. Cancel requests nobody answered.
  const requests = await prisma.booking.findMany({
    where: {
      cancelRequestedAt: { not: null },
      cancelRequestEscalatedAt: null,
      status: { in: ['ACCEPTED', 'IN_PROGRESS'] },
    },
  });
  for (const b of requests) {
    try {
      const asked = b.cancelRequestedAt!.getTime();
      let deadline = asked + CANCEL_REQUEST_TIMEOUT_HOURS * HOUR_MS;
      if (b.status === 'ACCEPTED') {
        const floor = Math.max(bookingStartInstant(b).getTime(), asked + CANCEL_REQUEST_MIN_ANSWER_MINUTES * MIN_MS);
        deadline = Math.min(deadline, floor);
      }
      if (now.getTime() < deadline) continue;
      await escalateCancelRequest(b, 'NO_ANSWER');
    } catch (error) {
      if (!isBookingStatusConflict(error)) console.error(`Failed to escalate cancel request for booking ${b.id}:`, error);
    }
  }

  const unstarted = await prisma.booking.findMany({
    where: {
      status: 'ACCEPTED',
      workerArrivedAt: { lte: new Date(now.getTime() - START_REMINDER_MINUTES * MIN_MS) },
      clientNotHereAt: null,
      OR: [{ startReminderSentAt: null }, { startNudgeSentAt: null }],
    },
    select: {
      ...NUDGE_FIELDS,
      workerArrivedAt: true,
      startReminderSentAt: true,
      startNudgeSentAt: true,
      disputes: { where: OPEN_DISPUTE, select: { id: true } },
    },
  });
  for (const b of unstarted) {
    try {
      const clock = new Date(Math.max(b.workerArrivedAt!.getTime(), bookingStartInstant(b).getTime()));
      if (!b.startReminderSentAt && b.workerId && due(clock, START_REMINDER_MINUTES * MIN_MS) && (await claim(b, 'startReminderSentAt'))) {
        await remind(b.workerId, b.id, 'Tap Start Job', "You checked in but haven't started. Add your before photos and tap Start Job.");
      }
      if (!b.startNudgeSentAt && !clientIsBeingHelped(b) && due(clock, START_NUDGE_HOURS * HOUR_MS) && (await claim(b, 'startNudgeSentAt'))) {
        await remind(b.clientId, b.id, 'Is your job under way?', "Your worker checked in but hasn't started. If something's wrong, tap Report a problem.");
      }
    } catch (error) {
      console.error(`Failed to nudge unstarted booking ${b.id}:`, error);
    }
  }

  // 3. Left in progress.
  const running = await prisma.booking.findMany({
    where: {
      status: 'IN_PROGRESS',
      workerStartedAt: { lte: new Date(now.getTime() - PROGRESS_REMINDER_HOURS * HOUR_MS) },
      OR: [{ progressReminderSentAt: null }, { progressEscalatedAt: null }],
    },
    select: {
      ...NUDGE_FIELDS,
      workerStartedAt: true,
      progressReminderSentAt: true,
      progressEscalatedAt: true,
      visits: { select: { scheduledDate: true, scheduledTime: true, status: true } },
      disputes: { where: OPEN_DISPUTE, select: { id: true } },
    },
  });
  let admins: { id: string }[] | null = null;
  for (const b of running) {
    try {
      const times = [b.workerStartedAt!, ...b.visits.filter((v) => v.status !== 'CANCELLED').map((v) => bookingStartInstant(v))];
      const clock = new Date(Math.max(...times.map((t) => t.getTime())));
      if (clock > now) continue;
      if (!b.progressReminderSentAt && b.workerId && due(clock, PROGRESS_REMINDER_HOURS * HOUR_MS) && (await claim(b, 'progressReminderSentAt'))) {
        await remind(b.workerId, b.id, 'Finish or schedule a follow-up', 'This job is still in progress. Mark it complete, or schedule a follow-up visit.');
      }
      if (!b.progressEscalatedAt && due(clock, PROGRESS_ESCALATE_HOURS * HOUR_MS) && (await claim(b, 'progressEscalatedAt'))) {
        if (!clientIsBeingHelped(b)) {
          await remind(b.clientId, b.id, 'Is your job finished?', "Your job is still marked in progress. If something's wrong, tap Report a problem.");
        }
        admins ??= await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
        const results = await Promise.allSettled(
          admins.map((a) => remind(a.id, b.id, 'Job stuck in progress', `Booking ${formatDisplayId(b.id)} has been in progress for over ${PROGRESS_ESCALATE_HOURS}h.`))
        );
        for (const r of results) if (r.status === 'rejected') console.error(`Failed to alert an admin about booking ${b.id}:`, r.reason);
      }
    } catch (error) {
      console.error(`Failed to nudge in-progress booking ${b.id}:`, error);
    }
  }
}

export async function cancelAsWorkerNoShow(
  booking: Booking,
  settings: { noShowGraceMinutes: number; noShowPenaltyAmount: number },
  now: Date = new Date()
): Promise<boolean> {
  const { noShowGraceMinutes, noShowPenaltyAmount } = settings;
  const workerId = booking.workerId;
  if (!workerId) return false;

  const cancelled = await prisma.$transaction(async (tx) => {
    const claim = await tx.booking.updateMany({
      where: { id: booking.id, status: 'ACCEPTED', workerArrivedAt: null },
      data: { status: 'CANCELLED', workerNoShowFlaggedAt: now },
    });
    if (claim.count === 0) return false;

    const workerProfile = await tx.workerProfile.update({
      where: { userId: workerId },
      data: { activeJobCount: { decrement: 1 } },
      select: { id: true },
    });

    await tx.bookingVisit.updateMany({
      where: { bookingId: booking.id, status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });

    await tx.dispute.updateMany({
      where: { bookingId: booking.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      data: {
        status: 'RESOLVED_DISMISSED',
        resolution: 'Booking was cancelled as a worker no-show before this dispute was resolved',
        resolvedAt: now,
      },
    });

    await tx.cancellation.create({
      data: {
        bookingId: booking.id,
        cancelledBy: 'ADMIN',
        cancelledById: 'system',
        reason: 'WORKER_NO_SHOW',
        cancelledWithinHours: 0,
        workerCancellationReason: 'WORKER_FAULT',
        penalizedWorkerId: booking.workerId,
        fault: 'WORKER',
        penaltyAmount: noShowPenaltyAmount > 0 ? noShowPenaltyAmount : null,
      },
    });

    if (noShowPenaltyAmount > 0) {
      await chargePenaltyTx(tx, workerProfile.id, noShowPenaltyAmount, {
        bookingId: booking.id,
        note: `No-show: didn't check in within ${noShowGraceMinutes} minutes of the start time`,
      });
    }
    return true;
  });
  if (!cancelled) return false;

  await requestRefund({ bookingId: booking.id, reason: 'WORKER_NO_SHOW', source: 'BOOKING_CANCELLED' }).catch((error) => {
    console.error(`Failed to void/refund-request payment for no-show booking ${booking.id}:`, error);
  });

  await notifyUser({
    userId: booking.clientId,
    type: 'BOOKING_CANCELLED',
    title: "Your worker didn't show up",
    message: `Your worker didn't check in within ${noShowGraceMinutes} minutes of the start time, so the booking was cancelled. You won't be charged — you can book another worker right away.`,
    relatedId: booking.id,
  });
  void sendSmsToUser({
    userId: booking.clientId,
    message: `HomeEase: Your worker didn't arrive for booking ${formatDisplayId(booking.id)}, so it was cancelled. You won't be charged.`,
  });

  await notifyUser({
    userId: workerId,
    type: 'CANCELLATION_PENALTY',
    title: 'Booking cancelled: no-show',
    message:
      noShowPenaltyAmount > 0
        ? `You didn't check in within ${noShowGraceMinutes} minutes of the start time, so the booking was cancelled and a ₱${noShowPenaltyAmount.toFixed(2)} penalty was added to your platform dues.`
        : `You didn't check in within ${noShowGraceMinutes} minutes of the start time, so the booking was cancelled.`,
    relatedId: booking.id,
  });

  await writeAuditLog({
    action: 'WORKER_NO_SHOW_CANCELLED',
    category: 'STATUS_CHANGE',
    level: 'WARN',
    message: `Booking ${booking.id} cancelled as a worker no-show (${noShowGraceMinutes} min past start, no check-in)`,
    metadata: { bookingId: booking.id, workerId: booking.workerId, penalty: noShowPenaltyAmount },
  });
  return true;
}

export async function escalateStaleDisputes(): Promise<void> {
  const { disputeEscalationHours } = await getAppSettings();
  const cutoff = new Date(Date.now() - disputeEscalationHours * HOUR_MS);

  const staleDisputes = await prisma.dispute.findMany({
    where: {
      status: { in: ['OPEN', 'UNDER_REVIEW'] },
      createdAt: { lte: cutoff },
      OR: [{ staleReminderSentAt: null }, { staleReminderSentAt: { lte: cutoff } }],
    },
    select: { id: true, bookingId: true, createdAt: true },
  });

  if (staleDisputes.length === 0) return;

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });

  for (const dispute of staleDisputes) {
    const ageHours = Math.round((Date.now() - dispute.createdAt.getTime()) / HOUR_MS);
    try {
      await Promise.all(
        admins.map((admin) =>
          notifyUser({
            userId: admin.id,
            type: 'DISPUTE_STALE_REMINDER',
            title: 'Dispute needs attention',
            message: `Dispute for booking ${formatDisplayId(dispute.bookingId)} has been open for ${ageHours}h with no resolution.`,
            relatedId: dispute.id,
          })
        )
      );
      await prisma.dispute.update({
        where: { id: dispute.id },
        data: { staleReminderSentAt: new Date() },
      });
    } catch (error) {
      console.error(`Failed to send stale-dispute reminder for dispute ${dispute.id}:`, error);
    }
  }

  await writeAuditLog({
    action: 'DISPUTE_STALE_REMINDER',
    category: 'STATUS_CHANGE',
    level: 'WARN',
    message: `${staleDisputes.length} dispute(s) re-escalated to admins after being open >${disputeEscalationHours}h`,
    metadata: { disputeIds: staleDisputes.map((d) => d.id) },
  });
}

export async function remindAndAutoConfirmReschedules(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - RESCHEDULE_REMINDER_HOURS * HOUR_MS);
  const autoConfirmCutoff = new Date(now - RESCHEDULE_AUTO_CONFIRM_HOURS * HOUR_MS);

  const needsReminder = await prisma.booking.findMany({
    where: {
      rescheduledAt: { lte: reminderCutoff },
      rescheduleReminderSentAt: null,
      rescheduleAcknowledgedAt: null,
    },
  });

  for (const booking of needsReminder) {
    await notifyUser({
      userId: booking.clientId,
      type: 'BOOKING_RESCHEDULE_REMINDER',
      title: 'Your booking was moved',
      message: 'Your worker needs another day — review the new date and confirm or cancel.',
      relatedId: booking.id,
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { rescheduleReminderSentAt: new Date() },
    });
  }

  const staleReschedules = await prisma.booking.findMany({
    where: {
      rescheduledAt: { lte: autoConfirmCutoff },
      rescheduleAcknowledgedAt: null,
    },
  });

  for (const booking of staleReschedules) {
    try {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { rescheduleAcknowledgedAt: new Date() },
      });

      await notifyUser({
        userId: booking.clientId,
        type: 'BOOKING_RESCHEDULE_CONFIRMED',
        title: 'New Date Confirmed',
        message: "You didn't respond in time, so the new date was automatically kept.",
        relatedId: booking.id,
      });
      if (booking.workerId) {
        await notifyUser({
          userId: booking.workerId,
          type: 'BOOKING_RESCHEDULE_CONFIRMED',
          title: 'New Date Confirmed',
          message: 'The client did not respond in time, so the moved date was automatically confirmed.',
          relatedId: booking.id,
        });
      }

      await writeAuditLog({
        action: 'BOOKING_RESCHEDULE_AUTO_CONFIRMED',
        category: 'STATUS_CHANGE',
        message: `Booking ${booking.id}'s rescheduled date auto-confirmed after 24h without client response`,
        metadata: { bookingId: booking.id },
      });
    } catch (error) {
      console.error(`Failed to auto-confirm reschedule for booking ${booking.id}:`, error);
    }
  }
}

export async function remindAndAutoDeclineRescheduleRequests(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - RESCHEDULE_REQUEST_REMINDER_HOURS * HOUR_MS);
  const autoDeclineCutoff = new Date(now - RESCHEDULE_REQUEST_AUTO_DECLINE_HOURS * HOUR_MS);

  const responderOf = (b: { rescheduleRequestedBy: string | null; clientId: string; workerId: string | null }) =>
    b.rescheduleRequestedBy === 'WORKER' ? b.clientId : b.workerId;
  const requesterOf = (b: { rescheduleRequestedBy: string | null; clientId: string; workerId: string | null }) =>
    b.rescheduleRequestedBy === 'WORKER' ? b.workerId : b.clientId;

  const needsReminder = await prisma.booking.findMany({
    where: {
      rescheduleRequestedAt: { lte: reminderCutoff },
      rescheduleRequestReminderSentAt: null,
      rescheduleRequestRespondedAt: null,
    },
  });

  for (const booking of needsReminder) {
    const responderId = responderOf(booking);
    if (!responderId) continue;
    await notifyUser({
      userId: responderId,
      type: 'BOOKING_RESCHEDULE_REQUESTED',
      title: 'Reschedule request waiting',
      message:
        booking.rescheduleRequestedBy === 'WORKER'
          ? 'Your worker is still waiting on your response to their reschedule request.'
          : 'Your client is still waiting on your response to their reschedule request.',
      relatedId: booking.id,
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { rescheduleRequestReminderSentAt: new Date() },
    });
  }

  const staleRequests = await prisma.booking.findMany({
    where: {
      rescheduleRequestedAt: { lte: autoDeclineCutoff },
      rescheduleRequestRespondedAt: null,
    },
  });

  for (const booking of staleRequests) {
    try {
      const claim = await prisma.booking.updateMany({
        where: { id: booking.id, rescheduleRequestRespondedAt: null },
        data: { rescheduleRequestRespondedAt: new Date(), rescheduleRequestAccepted: false },
      });
      if (claim.count === 0) continue;

      const requesterId = requesterOf(booking);
      if (requesterId) {
        await notifyUser({
          userId: requesterId,
          type: 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
          title: 'Reschedule Declined',
          message: 'Your reschedule request got no answer in time, so it was automatically declined. The booking stays as originally scheduled.',
          relatedId: booking.id,
        });
      }
      const responderId = responderOf(booking);
      if (responderId) {
        await notifyUser({
          userId: responderId,
          type: 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
          title: 'Reschedule Request Auto-Declined',
          message: "You didn't respond in time, so the reschedule request was automatically declined.",
          relatedId: booking.id,
        });
      }

      await writeAuditLog({
        action: 'BOOKING_RESCHEDULE_REQUEST_AUTO_DECLINED',
        category: 'STATUS_CHANGE',
        message: `Booking ${booking.id}'s reschedule request auto-declined after 48h without a response`,
        metadata: { bookingId: booking.id },
      });
    } catch (error) {
      console.error(`Failed to auto-decline reschedule request for booking ${booking.id}:`, error);
    }
  }
}

export async function flagExpiredKycDocuments(): Promise<void> {
  const now = new Date();

  const expiredDocs = await prisma.kycDocument.findMany({
    where: {
      status: 'APPROVED',
      expiresAt: { lte: now },
      verificationRequest: { status: 'APPROVED' },
    },
    select: { documentType: true, verificationRequest: { select: { userId: true } } },
  });

  if (expiredDocs.length === 0) return;

  const userIds = Array.from(new Set(expiredDocs.map((d) => d.verificationRequest.userId)));

  for (const userId of userIds) {
    try {
      const alreadyOpen = await prisma.verificationRequest.findFirst({
        where: { userId, type: 'REVERIFICATION', status: { in: ['PENDING', 'SUBMITTED'] } },
        select: { id: true },
      });
      if (alreadyOpen) continue;

      const expiredTypes = expiredDocs
        .filter((d) => d.verificationRequest.userId === userId)
        .map((d) => d.documentType);

      await prisma.verificationRequest.create({
        data: { userId, type: 'REVERIFICATION', status: 'PENDING' },
      });

      await notifyUser({
        userId,
        type: 'KYC_REVERIFICATION_REQUIRED',
        title: 'A verification document has expired',
        message: `Your ${expiredTypes.join(', ')} has expired. Please upload a current one to keep your account in good standing.`,
      });

      await writeAuditLog({
        action: 'KYC_REVERIFICATION_REQUIRED',
        category: 'STATUS_CHANGE',
        level: 'WARN',
        message: `Worker ${userId} flagged for re-verification — expired: ${expiredTypes.join(', ')}`,
        metadata: { userId, expiredTypes },
      });
    } catch (error) {
      console.error(`Failed to flag expired KYC documents for user ${userId}:`, error);
    }
  }
}

export async function autoSuspendUnderperformingWorkers(): Promise<void> {
  const {
    autoSuspendRatingThreshold,
    autoSuspendDisputeCountThreshold,
    autoSuspendDisputeCountWindowDays,
  } = await getAppSettings();

  const ratingGateEnabled = autoSuspendRatingThreshold != null;
  const disputeGateEnabled = autoSuspendDisputeCountThreshold != null && autoSuspendDisputeCountWindowDays != null;
  if (!ratingGateEnabled && !disputeGateEnabled) return;

  const candidateWorkers = await prisma.workerProfile.findMany({
    where: {
      user: { status: 'ACTIVE', isDeleted: false },
      kycStatus: 'APPROVED',
    },
    select: { id: true, userId: true, rating: true, totalReviews: true, user: { select: { fullName: true } } },
  });

  for (const worker of candidateWorkers) {
    try {
      const ratingBreach = ratingGateEnabled && worker.totalReviews > 0 && worker.rating <= autoSuspendRatingThreshold!;

      let disputeCount = 0;
      let disputeBreach = false;
      if (disputeGateEnabled) {
        const windowStart = new Date(Date.now() - autoSuspendDisputeCountWindowDays! * 24 * HOUR_MS);
        disputeCount = await prisma.dispute.count({
          where: { booking: { workerId: worker.userId }, createdAt: { gte: windowStart } },
        });
        disputeBreach = disputeCount >= autoSuspendDisputeCountThreshold!;
      }

      if (!ratingBreach && !disputeBreach) continue;

      const reasonParts = [
        ratingBreach ? `rating ${worker.rating.toFixed(1)} <= ${autoSuspendRatingThreshold}` : null,
        disputeBreach ? `${disputeCount} disputes in the last ${autoSuspendDisputeCountWindowDays} days` : null,
      ].filter(Boolean);

      await prisma.user.update({
        where: { id: worker.userId },
        data: { status: 'SUSPENDED' },
      });
      await revokeUserSessions(worker.userId, JWT_EXPIRY);
      await revokeAllRefreshTokens(worker.userId);

      await notifyUser({
        userId: worker.userId,
        type: 'ACCOUNT_AUTO_SUSPENDED',
        title: 'Your account has been suspended',
        message: `Your account was automatically suspended (${reasonParts.join('; ')}). Contact support to appeal.`,
      });

      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
      await Promise.all(
        admins.map((admin) =>
          notifyUser({
            userId: admin.id,
            type: 'ACCOUNT_AUTO_SUSPENDED',
            title: 'Worker auto-suspended',
            message: `${worker.user.fullName} was automatically suspended (${reasonParts.join('; ')}).`,
            relatedId: worker.userId,
          })
        )
      );

      await writeAuditLog({
        action: 'ACCOUNT_AUTO_SUSPENDED',
        category: 'STATUS_CHANGE',
        level: 'WARN',
        message: `Worker ${worker.user.fullName} (${worker.userId}) auto-suspended: ${reasonParts.join('; ')}`,
        metadata: { userId: worker.userId, ratingBreach, disputeBreach, disputeCount },
      });
    } catch (error) {
      console.error(`Failed to evaluate auto-suspension for worker ${worker.userId}:`, error);
    }
  }
}

const LIVE_LOCATION_MAX_AGE_MS = 2 * HOUR_MS;

export async function clearStaleWorkerLocations(): Promise<void> {
  const cutoff = new Date(Date.now() - LIVE_LOCATION_MAX_AGE_MS);
  const result = await prisma.workerProfile.updateMany({
    where: {
      currentLat: { not: null },
      OR: [
        { lastLocationUpdate: null },
        { lastLocationUpdate: { lt: cutoff } },
        { user: { bookingsAsWorker: { none: { status: 'ACCEPTED', workerArrivedAt: null } } } },
      ],
    },
    data: { currentLat: null, currentLng: null, lastLocationUpdate: null },
  });
  if (result.count > 0) {
    console.log(`Cleared stale live location for ${result.count} worker(s)`);
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
        case JOB_NAMES.NO_SHOW_SWEEP:
          await cancelWorkerNoShows();
          break;
        case JOB_NAMES.STUCK_BOOKING_SWEEP:
          await nudgeStuckBookings();
          break;
        case JOB_NAMES.DISPUTE_SLA_SWEEP:
          await escalateStaleDisputes();
          break;
        case JOB_NAMES.RESCHEDULE_TIMEOUT_SWEEP:
          await remindAndAutoConfirmReschedules();
          break;
        case JOB_NAMES.RESCHEDULE_REQUEST_TIMEOUT_SWEEP:
          await remindAndAutoDeclineRescheduleRequests();
          break;
        case JOB_NAMES.KYC_EXPIRY_SWEEP:
          await flagExpiredKycDocuments();
          break;
        case JOB_NAMES.AUTO_SUSPEND_SWEEP:
          await autoSuspendUnderperformingWorkers();
          break;
        case JOB_NAMES.LOCATION_CLEANUP_SWEEP:
          await clearStaleWorkerLocations();
          break;
        case JOB_NAMES.DATA_RETENTION_SWEEP:
          await purgeExpiredData();
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

  worker.on('error', (err) => {
    console.error('bookingWorker Redis connection error:', err.message);
  });

  return worker;
}
