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
// The invoice has been sent this long without being paid: remind the client
// (and, for cash, the worker to tap "Cash received").
const COMPLETION_REMINDER_HOURS = 12;
// AWAITING_PAYMENT gets a much shorter, separate reminder than the general
// 12h one — a checkout exists, so this is a "you have one thing left, come
// finish it" nudge for an abandoned/forgotten Xendit webview.
const PAYMENT_REMINDER_HOURS = 2;
// A cash invoice the worker never marked "Cash received" and the client never
// reported is recorded as paid after this long. The client had the whole
// window to report it (and a second reminder a day before the end); the
// worker is told so they can contact support. A booking that already went
// through a dispute is never auto-settled.
const CASH_AUTO_SETTLE_HOURS = 72;
const CASH_SECOND_REMINDER_HOURS = 48;
// A GCash/Maya booking the client never paid is escalated to an admin
// dispute after this long. No platform money is fronted — the worker is
// simply not paid until it clears.
const PAYMENT_OVERDUE_DISPUTE_HOURS = 72;
// Reconcile a payment/payout that's been mid-flight longer than this against
// Xendit directly, in case a webhook was missed.
const RECONCILE_AFTER_HOURS = 1;
// A client who never
// opens the app to explicitly keep/decline a reschedule shouldn't leave it
// unresolved forever (see bookingController.extendBooking/acknowledgeReschedule).
const RESCHEDULE_REMINDER_HOURS = 12;
const RESCHEDULE_AUTO_CONFIRM_HOURS = 24;
// A client-initiated reschedule REQUEST (see bookingController.
// requestReschedule) isn't as urgent as the conflict-driven one above — the
// original slot stays untouched until the worker explicitly accepts, so
// nothing is stuck in limbo while it's unanswered. Auto-DECLINE rather than
// auto-confirm is the safer default: it preserves the worker's original
// commitment instead of forcing a date change nobody explicitly agreed to.
const RESCHEDULE_REQUEST_REMINDER_HOURS = 24;
const RESCHEDULE_REQUEST_AUTO_DECLINE_HOURS = 48;
// Stuck-booking sweep (see nudgeStuckBookings).
const CANCEL_REQUEST_TIMEOUT_HOURS = 2;
const CANCEL_REQUEST_MIN_ANSWER_MINUTES = 15;
const START_REMINDER_MINUTES = 30;
const START_NUDGE_HOURS = 2;
const PROGRESS_REMINDER_HOURS = 12;
const PROGRESS_ESCALATE_HOURS = 48;

/**
 * A PENDING booking that no worker responded to within an hour is
 * auto-cancelled: escrow is voided/refunded and a Cancellation record
 * captures why.
 */
export async function expirePendingBooking(data: ExpirePendingBookingJobData): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: data.bookingId } });
  if (!booking || booking.status !== 'PENDING') return; // already resolved by accept/decline/cancel

  try {
    await prisma.$transaction(async (tx) => {
      // Still-PENDING guard: the worker may have accepted since the read above.
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
        type: 'DISPUTE_OPENED',
        title: 'Payment Overdue',
        message: `Booking ${formatDisplayId(booking.id)} has been awaiting client payment for over ${PAYMENT_OVERDUE_DISPUTE_HOURS}h.`,
        relatedId: dispute.id,
      })
    )
  );

  // Both parties should know this happened, not just admins — the client
  // needs to know they're now in a dispute (and why), and the worker
  // deserves to know their unpaid job has been escalated rather than
  // silently sitting there.
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

/**
 * Unpaid-invoice safety net (the worker sends the invoice at completion).
 *
 *  - PENDING_COMPLETION / AWAITING_PAYMENT 12h -> nudge the client to pay
 *    (and, for cash, the worker to tap "Cash received").
 *  - AWAITING_PAYMENT 2h (own clock, separate from the 12h above) -> nudge
 *    the client to finish an abandoned/forgotten Xendit checkout.
 *  - PENDING_COMPLETION + CASH 48h -> second reminder, a day before the end.
 *  - PENDING_COMPLETION + CASH 72h -> recorded as paid (settleCashBooking).
 *    A reported invoice is DISPUTED, so it's never picked up here.
 *  - PENDING_COMPLETION / AWAITING_PAYMENT 72h + GCash/Maya -> escalate to an
 *    admin dispute. No auto-complete, no platform funds fronted.
 *  - Reconciliation: PENDING payments / PROCESSING payouts older than 1h are
 *    re-checked against Xendit in case a webhook was missed.
 *  - Self-heal: COMPLETED bookings whose worker payout never got created.
 */
export async function remindAndAutoSettleCompletions(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - COMPLETION_REMINDER_HOURS * HOUR_MS);
  const paymentReminderCutoff = new Date(now - PAYMENT_REMINDER_HOURS * HOUR_MS);
  const overdueCutoff = new Date(now - PAYMENT_OVERDUE_DISPUTE_HOURS * HOUR_MS);
  const reconcileCutoff = new Date(now - RECONCILE_AFTER_HOURS * HOUR_MS);
  const cashSettleCutoff = new Date(now - CASH_AUTO_SETTLE_HOURS * HOUR_MS);

  // 1. 12h reminder — the invoice was sent and is still unpaid.
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

  // 1a. Cash second reminder at 48h. Claim first so the BullMQ sweep and
  // /internal/cron can't both send it.
  const secondReminderCutoff = new Date(now - CASH_SECOND_REMINDER_HOURS * HOUR_MS);
  const needsSecondReminder = await prisma.booking.findMany({
    where: {
      status: 'PENDING_COMPLETION',
      OR: [{ paymentMethodType: 'CASH' }, { paymentMethodType: null }],
      // Past 72h it is settled in this same run, so no "in 1 day" warning.
      workerCompletedAt: { lte: secondReminderCutoff, gt: cashSettleCutoff },
      // A booking that went through a dispute, or has one open, is never auto-settled.
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

  // 1b. AWAITING_PAYMENT-specific reminder — much shorter than the general
  // 12h one above, and on its own clock (awaitingPaymentSince, not
  // workerCompletedAt) so it fires promptly even for a booking that sat in
  // PENDING_COMPLETION for a while (and already got its 12h reminder there)
  // before the client finally confirmed and then abandoned the checkout.
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

  // 2. A cash invoice nobody confirmed or reported in 72h -> recorded as paid.
  const staleCash = await prisma.booking.findMany({
    where: {
      status: 'PENDING_COMPLETION',
      OR: [{ paymentMethodType: 'CASH' }, { paymentMethodType: null }],
      workerCompletedAt: { lte: cashSettleCutoff },
      disputeResolvedAt: null,
      // A problem reported before the invoice can still be open here.
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

  // 4a. The same safety net for a worker's platform-dues invoices: a missed
  //     invoice-paid webhook, or an invoice whose id was never saved because the
  //     server stopped mid-checkout (see debtPaymentService).
  for (const { debtPaymentId, result } of await reconcileStalePendingDebtPayments(reconcileCutoff)) {
    await writeAuditLog({
      action: 'DUES_PAYMENT_RECONCILED',
      category: 'STATUS_CHANGE',
      message: `Dues payment ${debtPaymentId} reconciled from Xendit as ${result} (webhook likely missed)`,
      metadata: { debtPaymentId, result },
    });
  }

  // 4b. Follow up refunds Xendit accepted but hadn't finished (e-wallet
  //     refunds often start PENDING).
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

  // 5. Reconcile PROCESSING payouts against Xendit (missed payout webhook).
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

  // 5b. PROCESSING payouts with no Xendit id: the process died (deploy, OOM)
  //     between claiming the payout and saving createPayout's answer. Ask
  //     Xendit whether it got the request: adopt that payout if so, otherwise
  //     put the row back to PENDING so step 6 re-enqueues it.
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
 * Worker no-show: an ACCEPTED booking whose start time passed
 * AppSettings.noShowGraceMinutes ago with no check-in is cancelled, and the
 * worker is charged AppSettings.noShowPenaltyAmount (added to their platform
 * dues, recovered from later payouts) plus the auto-match late-cancel
 * penalty (Cancellation.penalizedWorkerId). The client is free to book again
 * straight away. A worker who can't make it should reschedule with the
 * client beforehand (bookingController.requestReschedule).
 */
export async function cancelWorkerNoShows(): Promise<void> {
  const { noShowGraceMinutes, noShowPenaltyAmount } = await getAppSettings();
  const now = new Date();

  const candidates = await prisma.booking.findMany({
    where: {
      status: 'ACCEPTED',
      workerArrivedAt: null,
      // Cheap DB-side pre-filter — a booking scheduled for a future day
      // can't be a no-show yet. The precise start-time check is below.
      // scheduledDate is the PH calendar day at UTC midnight, so compare it
      // to today's PH date: comparing to `now` skipped the morning's
      // bookings from 00:00 to 08:00 PH, when the PH date is a day ahead.
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

/**
 * Catches bookings that stall without anyone doing anything wrong on paper:
 * a client cancel request the worker never answered, a worker who checked in
 * but never tapped Start Job, and a job left IN_PROGRESS for days. Each step
 * nudges at most once: the *SentAt column is claimed first (a conditional
 * update), and only the run that wins the claim sends.
 */
export async function nudgeStuckBookings(now = new Date()): Promise<void> {
  const MIN_MS = 60 * 1000;
  const due = (clock: Date, ms: number) => now.getTime() >= clock.getTime() + ms;
  const remind = (userId: string, bookingId: string, title: string, message: string) =>
    notifyUser({ userId, type: 'BOOKING_REMINDER', title, message, relatedId: bookingId });
  // Stamps the column only if still unset and the status unchanged, so two
  // overlapping runs can't both send. Claim-then-send: notifyUser never throws,
  // so a nudge is lost only if the process dies between the claim and the send.
  const claim = async (b: { id: string; status: Booking['status'] }, column: 'startReminderSentAt' | 'startNudgeSentAt' | 'progressReminderSentAt' | 'progressEscalatedAt') =>
    (await prisma.booking.updateMany({ where: { id: b.id, status: b.status, [column]: null }, data: { [column]: now } })).count === 1;

  // The client nudges say "tap Report a problem", which the app hides while a
  // dispute or the client's own cancel request is open, so skip them then.
  const OPEN_DISPUTE = { status: { in: ['OPEN', 'UNDER_REVIEW'] } };
  // What passes 2 and 3 read besides their own columns.
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
        // A request just before the start still gives the worker 15 minutes.
        const floor = Math.max(bookingStartInstant(b).getTime(), asked + CANCEL_REQUEST_MIN_ANSWER_MINUTES * MIN_MS);
        deadline = Math.min(deadline, floor);
      }
      if (now.getTime() < deadline) continue;
      await escalateCancelRequest(b, 'NO_ANSWER');
    } catch (error) {
      if (!isBookingStatusConflict(error)) console.error(`Failed to escalate cancel request for booking ${b.id}:`, error);
    }
  }

  // 2. Checked in, never started.
  const unstarted = await prisma.booking.findMany({
    where: {
      status: 'ACCEPTED',
      // The clock is a max with workerArrivedAt, so nothing is due before this.
      workerArrivedAt: { lte: new Date(now.getTime() - START_REMINDER_MINUTES * MIN_MS) },
      OR: [{ startReminderSentAt: null }, { startNudgeSentAt: null, clientNotHereAt: null }],
    },
    select: {
      ...NUDGE_FIELDS,
      workerArrivedAt: true,
      startReminderSentAt: true,
      startNudgeSentAt: true,
      clientNotHereAt: true,
      disputes: { where: OPEN_DISPUTE, select: { id: true } },
    },
  });
  for (const b of unstarted) {
    try {
      // An early check-in doesn't count until the booked start.
      const clock = new Date(Math.max(b.workerArrivedAt!.getTime(), bookingStartInstant(b).getTime()));
      if (!b.startReminderSentAt && b.workerId && due(clock, START_REMINDER_MINUTES * MIN_MS) && (await claim(b, 'startReminderSentAt'))) {
        await remind(b.workerId, b.id, 'Tap Start Job', "You checked in but haven't started. Add your before photos and tap Start Job.");
      }
      if (!b.startNudgeSentAt && !b.clientNotHereAt && !clientIsBeingHelped(b) && due(clock, START_NUDGE_HOURS * HOUR_MS) && (await claim(b, 'startNudgeSentAt'))) {
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
      // A follow-up visit planned ahead restarts the clock from that visit.
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

/**
 * Cancels one ACCEPTED booking as a worker no-show (see cancelWorkerNoShows,
 * which checks the deadline first). Returns whether it cancelled — false when
 * a check-in or cancel raced it.
 */
export async function cancelAsWorkerNoShow(
  booking: Booking,
  settings: { noShowGraceMinutes: number; noShowPenaltyAmount: number },
  now: Date = new Date()
): Promise<boolean> {
  const { noShowGraceMinutes, noShowPenaltyAmount } = settings;
  const workerId = booking.workerId;
  if (!workerId) return false;

  const cancelled = await prisma.$transaction(async (tx) => {
    // Status-guarded: a check-in or cancel that raced this sweep wins.
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

    // Same as finalizeCancellationTx: the cancel ends any dispute still open.
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

/**
 * A dispute has no SLA at all otherwise — resolveDispute
 * (adminDisputeController.ts) is the only way out of OPEN/UNDER_REVIEW, so
 * an admin who never looks leaves both the booking and the worker's payout
 * frozen indefinitely. Re-notifies every admin every
 * AppSettings.disputeEscalationHours a dispute stays unresolved (a repeat
 * nag, not a one-shot notice — see Dispute.staleReminderSentAt) until it's
 * actually resolved.
 */
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

/**
 * Client-response safety net for a rescheduled booking (see
 * bookingController.extendBooking/acknowledgeReschedule): a 12h reminder, then an unresponsive client's
 * new date auto-confirms at 24h so the episode doesn't sit open forever.
 */
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

/**
 * Safety net for a reschedule REQUEST (see bookingController.
 * requestReschedule/respondToRescheduleRequest): a 24h reminder to whoever
 * has to answer, then an unanswered request auto-declines at 48h — the
 * booking keeps its original date.
 */
export async function remindAndAutoDeclineRescheduleRequests(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - RESCHEDULE_REQUEST_REMINDER_HOURS * HOUR_MS);
  const autoDeclineCutoff = new Date(now - RESCHEDULE_REQUEST_AUTO_DECLINE_HOURS * HOUR_MS);

  // A request from before rescheduleRequestedBy existed came from the client.
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

/**
 * A government clearance (NBI/police/barangay/cedula) that was approved
 * once stayed valid forever afterward — KycDocument.expiresAt (see
 * adminVerificationController.approveDocument, which auto-computes it from
 * CLEARANCE_VALIDITY_DAYS) now actually tracks the real-world expiry, and
 * this hourly sweep opens a REVERIFICATION request once one passes. Purely
 * advisory: doesn't touch kycStatus or block the worker from working, just
 * asks them to resubmit — matches this file's other "flag, don't block"
 * sweeps.
 */
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
      // Already flagged and waiting on the worker — don't re-open/re-notify
      // every hour while it's still outstanding.
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

/**
 * There was previously no mechanism tying a worker's rating or dispute
 * history to their account status at all — a worker could rack up a 1.5
 * rating or a dozen disputes and keep taking bookings indefinitely, with an
 * admin only finding out if they happened to look. Off by default (see
 * AppSettings.autoSuspendRatingThreshold's schema comment) — an admin opts
 * in by setting both a rating floor and a dispute-count/window pair. Only
 * ever SUSPENDS (reversible); an admin still makes the call to ban or
 * reinstate.
 */
export async function autoSuspendUnderperformingWorkers(): Promise<void> {
  const {
    autoSuspendRatingThreshold,
    autoSuspendDisputeCountThreshold,
    autoSuspendDisputeCountWindowDays,
  } = await getAppSettings();

  const ratingGateEnabled = autoSuspendRatingThreshold != null;
  const disputeGateEnabled = autoSuspendDisputeCountThreshold != null && autoSuspendDisputeCountWindowDays != null;
  if (!ratingGateEnabled && !disputeGateEnabled) return;

  // Deliberately no DB-level rating pre-filter here even though
  // ratingGateEnabled could support one: when BOTH gates are configured, a
  // worker breaching only the dispute-count gate (fine rating, too many
  // disputes) would otherwise be silently excluded before the per-worker
  // dispute check below ever runs. Correctness over the minor efficiency
  // loss of scanning every active, KYC-approved worker each hour.
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
      // Same immediate-effect session revocation as a manual admin suspend
      // (adminUserController.setUserStatus) — otherwise an auto-suspended
      // worker could keep working off their existing access token for up
      // to its full remaining lifetime.
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

// Live location is only collected while a worker travels to an ACCEPTED
// booking (updateWorkerLiveLocation) and is cleared at check-in
// (arriveBooking). This backstop clears anything left over — a cancelled
// trip, an app that stopped pinging — so a worker's position is never
// retained beyond what the Privacy Policy states (Data Privacy Act §11).
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

  // Mandatory per BullMQ's own docs — see the identical note in
  // bookingQueue.ts. Distinct from 'failed' above: that's a job that ran
  // and errored, this is the worker's own Redis connection dropping.
  worker.on('error', (err) => {
    console.error('bookingWorker Redis connection error:', err.message);
  });

  return worker;
}
