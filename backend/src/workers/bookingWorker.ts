import { Worker, type Job } from 'bullmq';
import prisma from '@config/database';
import { workerConnection as connection } from '@config/redis';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { writeAuditLog } from '@utils/auditLog';
import { BOOKING_QUEUE_NAME, JOB_NAMES, type ExpirePendingBookingJobData } from '@queues/bookingQueue';
import { freeSlot, materializeTemplateForWorker, getSlotStartInstant } from '@services/workerAvailabilityService';
import { getAppSettings } from '@services/appSettingsService';
import {
  refundOrVoidPayment,
  settleCashBooking,
  settleWorkerEarnings,
  reconcilePendingPayment,
} from '@services/paymentLifecycleService';
import { retrievePayout } from '@services/xenditDisbursementService';
import { schedulePayout } from '@queues/payoutQueue';
import { formatDisplayId } from '@utils/formatters';
import { revokeUserSessions } from '@utils/tokenRevocation';
import { revokeAllRefreshTokens } from '@utils/otpService';
import { JWT_EXPIRY } from '@utils/jwt';

const HOUR_MS = 60 * 60 * 1000;
const COMPLETION_REMINDER_HOURS = 12;
// AWAITING_PAYMENT gets a much shorter, separate reminder than the general
// 12h completion one — the client already confirmed and a checkout exists,
// so this is a "you have one thing left, come finish it" nudge for an
// abandoned/forgotten Xendit webview, not "go review a photo and decide."
const PAYMENT_REMINDER_HOURS = 2;
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
// Shorter than the quote window — a mid-job addon happens while the job is
// actively being worked on (the client is presumably reachable/nearby),
// and most bookings complete well within a day anyway (completeBooking
// auto-resolves anything still pending at that point regardless), so this
// sweep mainly matters for longer-running jobs.
const ADDON_REMINDER_HOURS = 2;
const ADDON_AUTO_APPROVE_HOURS = 6;
// Same shape as the quote-approval safety net above — a client who never
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

/**
 * A PENDING booking that no worker responded to within an hour is
 * auto-cancelled: escrow is voided/refunded, the assigned worker's slot (if
 * any) is freed, and a Cancellation record captures why.
 */
export async function expirePendingBooking(data: ExpirePendingBookingJobData): Promise<void> {
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
        await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot, booking.estimatedDurationHours);
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
 * Post-completion payment safety net (pay-after-completion model).
 *
 *  - PENDING_COMPLETION 12h  -> nudge the client to confirm.
 *  - AWAITING_PAYMENT 2h (own clock, separate from the 12h above) -> nudge
 *    the client to finish an abandoned/forgotten Xendit checkout.
 *  - PENDING_COMPLETION 24h + CASH -> auto-confirm: the client is assumed to
 *    have paid the worker in person, so the booking is finalized and the
 *    platform's cut is accrued as worker commission debt (settleCashBooking).
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
export async function remindAndAutoApproveQuotes(): Promise<void> {
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
    // Only approved add-ons count toward finalPrice — see
    // BookingAddOn.clientApprovedAt's schema comment. Mirrors
    // bookingController.approveQuote's own formula, which this sweep is the
    // unattended equivalent of.
    include: { addOns: { where: { clientApprovedAt: { not: null } } } },
  });

  for (const booking of staleQuotes) {
    if (booking.laborCost == null || booking.materialsCost == null) continue;

    const addonsCost = booking.addOns.reduce((sum, addon) => sum + addon.price, 0);

    try {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: 'QUOTE_APPROVED',
          quoteStatus: 'APPROVED',
          approvedAt: new Date(),
          finalPrice: booking.laborCost! + booking.materialsCost! + addonsCost,
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
 * Client-response safety net for a mid-job addon (see
 * bookingController.addAddon/respondToAddon) — same shape as
 * remindAndAutoApproveQuotes: a 2h reminder, then an unresponsive client's
 * addon auto-approves at 6h so a worker who already supplied the extra
 * materials/labor isn't stuck never getting paid for it because the client
 * never opened the app. Anything still pending when the job is marked
 * complete is separately auto-REJECTED by completeBooking itself (add-ons
 * freeze at completion) — this sweep only ever runs before that point.
 */
export async function remindAndAutoApproveAddons(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - ADDON_REMINDER_HOURS * HOUR_MS);
  const autoApproveCutoff = new Date(now - ADDON_AUTO_APPROVE_HOURS * HOUR_MS);

  const pendingWhere = { clientApprovedAt: null, clientRejectedAt: null } as const;

  const needsReminder = await prisma.bookingAddOn.findMany({
    where: { ...pendingWhere, createdAt: { lte: reminderCutoff }, reminderSentAt: null },
    include: { booking: { select: { id: true, clientId: true } } },
  });

  for (const addon of needsReminder) {
    await notifyUser({
      userId: addon.booking.clientId,
      type: 'ADDON_ADDED',
      title: 'An addon is waiting for your approval',
      message: `"${addon.name}" (₱${addon.price}) still needs your approval — review it before it auto-approves.`,
      relatedId: addon.booking.id,
    });
    await prisma.bookingAddOn.update({
      where: { id: addon.id },
      data: { reminderSentAt: new Date() },
    });
  }

  const staleAddons = await prisma.bookingAddOn.findMany({
    where: { ...pendingWhere, createdAt: { lte: autoApproveCutoff } },
    include: { booking: { select: { id: true, clientId: true, workerId: true } } },
  });

  for (const addon of staleAddons) {
    try {
      await prisma.bookingAddOn.update({
        where: { id: addon.id },
        data: { clientApprovedAt: new Date() },
      });

      if (addon.booking.workerId) {
        await notifyUser({
          userId: addon.booking.workerId,
          type: 'ADDON_ADDED',
          title: 'Addon Auto-Approved',
          message: `The client did not respond in time, so "${addon.name}" (₱${addon.price}) was automatically approved.`,
          relatedId: addon.booking.id,
        });
      }
      await notifyUser({
        userId: addon.booking.clientId,
        type: 'ADDON_ADDED',
        title: 'Addon Auto-Approved',
        message: `You didn't respond in time, so "${addon.name}" (₱${addon.price}) was automatically approved and will be billed.`,
        relatedId: addon.booking.id,
      });

      await writeAuditLog({
        action: 'ADDON_AUTO_APPROVED',
        category: 'STATUS_CHANGE',
        message: `Addon ${addon.id} on booking ${addon.bookingId} auto-approved after ${ADDON_AUTO_APPROVE_HOURS}h without client response`,
        metadata: { bookingId: addon.bookingId, addonId: addon.id, price: addon.price },
      });
    } catch (error) {
      console.error(`Failed to auto-approve addon ${addon.id}:`, error);
    }
  }
}

/**
 * There was previously no concept of a worker no-show at all — an ACCEPTED
 * booking whose worker simply never opened the app again left the client
 * with no way out (cancelBooking hard-blocks a client past PENDING by
 * design). Flags a booking once its scheduled slot start +
 * AppSettings.noShowGraceHours has passed with no workerArrivedAt, which
 * lets cancelBooking's carve-out apply and attributes the eventual
 * cancellation's auto-match penalty to the worker (see
 * Cancellation.penalizedWorkerId).
 */
export async function flagWorkerNoShows(): Promise<void> {
  const { noShowGraceHours } = await getAppSettings();
  const now = new Date();

  const candidates = await prisma.booking.findMany({
    where: {
      status: 'ACCEPTED',
      workerArrivedAt: null,
      workerNoShowFlaggedAt: null,
      timeSlot: { not: null },
      // Cheap DB-side pre-filter — a booking scheduled for a future day
      // can't possibly be a no-show yet. The precise, PH-timezone-aware
      // slot-start check (getSlotStartInstant) happens per-candidate below.
      scheduledDate: { lte: now },
    },
  });

  for (const booking of candidates) {
    const slotStart = getSlotStartInstant(booking.scheduledDate, booking.timeSlot!);
    const graceDeadline = new Date(slotStart.getTime() + noShowGraceHours * HOUR_MS);
    if (now < graceDeadline) continue;

    try {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { workerNoShowFlaggedAt: now },
      });

      await notifyUser({
        userId: booking.clientId,
        type: 'WORKER_NO_SHOW_FLAGGED',
        title: "Your worker hasn't checked in",
        message: `Your worker hasn't checked in, ${noShowGraceHours}h past the scheduled start time. You can now cancel this booking free of charge if you'd like.`,
        relatedId: booking.id,
      });

      if (booking.workerId) {
        await notifyUser({
          userId: booking.workerId,
          type: 'WORKER_NO_SHOW_FLAGGED',
          title: 'Marked as a possible no-show',
          message: `You haven't checked in for a booking that started ${noShowGraceHours}h ago. Please arrive and check in, or contact support — the client can now cancel this booking free of charge.`,
          relatedId: booking.id,
        });
      }

      await writeAuditLog({
        action: 'WORKER_NO_SHOW_FLAGGED',
        category: 'STATUS_CHANGE',
        level: 'WARN',
        message: `Booking ${booking.id} flagged as a worker no-show (${noShowGraceHours}h past scheduled start, no check-in)`,
        metadata: { bookingId: booking.id, workerId: booking.workerId },
      });
    } catch (error) {
      console.error(`Failed to flag worker no-show for booking ${booking.id}:`, error);
    }
  }
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
 * bookingController.extendBooking/acknowledgeReschedule) — same shape as
 * remindAndAutoApproveQuotes: a 12h reminder, then an unresponsive client's
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
      message: 'Your pro needs another day — review the new date and confirm or cancel.',
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
 * Worker-response safety net for a client-initiated reschedule REQUEST (see
 * bookingController.requestReschedule/respondToRescheduleRequest) — a 24h
 * reminder, then an unresponsive worker's request auto-declines at 48h
 * (releasing the held slot) rather than sitting open forever.
 */
export async function remindAndAutoDeclineRescheduleRequests(): Promise<void> {
  const now = Date.now();
  const reminderCutoff = new Date(now - RESCHEDULE_REQUEST_REMINDER_HOURS * HOUR_MS);
  const autoDeclineCutoff = new Date(now - RESCHEDULE_REQUEST_AUTO_DECLINE_HOURS * HOUR_MS);

  const needsReminder = await prisma.booking.findMany({
    where: {
      rescheduleRequestedAt: { lte: reminderCutoff },
      rescheduleRequestReminderSentAt: null,
      rescheduleRequestRespondedAt: null,
    },
  });

  for (const booking of needsReminder) {
    if (!booking.workerId) continue;
    await notifyUser({
      userId: booking.workerId,
      type: 'BOOKING_RESCHEDULE_REQUESTED',
      title: 'Reschedule request waiting',
      message: 'Your client is still waiting on your response to their reschedule request.',
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
      await prisma.$transaction(async (tx) => {
        if (booking.workerId && booking.requestedScheduledDate && booking.requestedTimeSlot) {
          const workerProfile = await tx.workerProfile.findUnique({
            where: { userId: booking.workerId },
            select: { id: true },
          });
          if (workerProfile) {
            await tx.workerAvailability.updateMany({
              where: {
                workerProfileId: workerProfile.id,
                date: booking.requestedScheduledDate,
                timeSlot: booking.requestedTimeSlot,
                blockedByBookingId: booking.id,
                isBooked: false,
              },
              data: { isBlocked: false, blockedByBookingId: null },
            });
          }
        }

        await tx.booking.update({
          where: { id: booking.id },
          data: { rescheduleRequestRespondedAt: new Date(), rescheduleRequestAccepted: false },
        });
      });

      await notifyUser({
        userId: booking.clientId,
        type: 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
        title: 'Reschedule Declined',
        message: "Your pro didn't respond in time, so your reschedule request was automatically declined. Your booking stays as originally scheduled.",
        relatedId: booking.id,
      });
      if (booking.workerId) {
        await notifyUser({
          userId: booking.workerId,
          type: 'BOOKING_RESCHEDULE_REQUEST_DECLINED',
          title: 'Reschedule Request Auto-Declined',
          message: "You didn't respond in time, so the client's reschedule request was automatically declined.",
          relatedId: booking.id,
        });
      }

      await writeAuditLog({
        action: 'BOOKING_RESCHEDULE_REQUEST_AUTO_DECLINED',
        category: 'STATUS_CHANGE',
        message: `Booking ${booking.id}'s reschedule request auto-declined after 48h without worker response`,
        metadata: { bookingId: booking.id },
      });
    } catch (error) {
      console.error(`Failed to auto-decline reschedule request for booking ${booking.id}:`, error);
    }
  }
}

/**
 * Clears stale isBooked flags on past-dated WorkerAvailability rows. A slot
 * can be left marked isBooked if a booking concluded through a path that
 * didn't explicitly free it (defense-in-depth self-heal, not the primary
 * mechanism — accept/complete/cancel free their own slot inline).
 */
export async function resetExpiredAvailabilitySlots(): Promise<void> {
  const ACTIVE_STATUSES = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED', 'DISPUTED'] as const;

  // Not date-bounded — an isBooked slot with no matching active booking is
  // stale whether that date is in the past or still upcoming (e.g. a booking
  // that was cancelled/completed through a path that missed freeSlot). Only
  // checking past dates left an orphaned future slot stuck as "booked" until
  // its date happened to lapse.
  const staleBookedSlots = await prisma.workerAvailability.findMany({
    where: { isBooked: true },
    include: { workerProfile: { select: { userId: true } } },
  });

  for (const slot of staleBookedSlots) {
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

  // Same idea for the soft "isBlocked" hold reschedule-on-conflict and
  // reschedule-on-request use while a booking is mid-flight (see
  // bookingController.extendBooking / requestReschedule). Both flows clear
  // the hold themselves when the episode resolves (accept/decline/withdraw,
  // or the owning booking is cancelled/completed) — this is only a backstop
  // for a hold left dangling by a crash or a path that missed that cleanup.
  const staleBlockedSlots = await prisma.workerAvailability.findMany({
    where: { isBlocked: true, blockedByBookingId: { not: null } },
  });

  for (const slot of staleBlockedSlots) {
    const holdingBooking = await prisma.booking.findUnique({
      where: { id: slot.blockedByBookingId! },
      select: { status: true, rescheduleRequestRespondedAt: true },
    });

    const stale =
      !holdingBooking ||
      holdingBooking.status === 'COMPLETED' ||
      holdingBooking.status === 'CANCELLED' ||
      holdingBooking.rescheduleRequestRespondedAt != null;

    if (stale) {
      await prisma.workerAvailability.update({
        where: { id: slot.id },
        data: { isBlocked: false, blockedByBookingId: null },
      });
    }
  }
}

/**
 * Daily sweep (see B8) that rolls every worker's recurring weekly template
 * (see WorkerAvailabilityTemplate / workerController.updateMyAvailabilityTemplate)
 * forward into real WorkerAvailability rows, so the open booking horizon
 * keeps advancing instead of only covering the day the template was saved.
 */
export async function materializeAvailabilityTemplates(): Promise<void> {
  const workerProfileIds = await prisma.workerAvailabilityTemplate.findMany({
    distinct: ['workerProfileId'],
    select: { workerProfileId: true },
  });

  for (const { workerProfileId } of workerProfileIds) {
    await materializeTemplateForWorker(prisma, workerProfileId);
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
        data: { status: 'SUSPENDED', isDeleted: true, deletedAt: new Date() },
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
        case JOB_NAMES.ADDON_TIMEOUT_SWEEP:
          await remindAndAutoApproveAddons();
          break;
        case JOB_NAMES.NO_SHOW_SWEEP:
          await flagWorkerNoShows();
          break;
        case JOB_NAMES.DISPUTE_SLA_SWEEP:
          await escalateStaleDisputes();
          break;
        case JOB_NAMES.RESET_AVAILABILITY:
          await resetExpiredAvailabilitySlots();
          break;
        case JOB_NAMES.RESCHEDULE_TIMEOUT_SWEEP:
          await remindAndAutoConfirmReschedules();
          break;
        case JOB_NAMES.RESCHEDULE_REQUEST_TIMEOUT_SWEEP:
          await remindAndAutoDeclineRescheduleRequests();
          break;
        case JOB_NAMES.MATERIALIZE_AVAILABILITY_TEMPLATES:
          await materializeAvailabilityTemplates();
          break;
        case JOB_NAMES.KYC_EXPIRY_SWEEP:
          await flagExpiredKycDocuments();
          break;
        case JOB_NAMES.AUTO_SUSPEND_SWEEP:
          await autoSuspendUnderperformingWorkers();
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
