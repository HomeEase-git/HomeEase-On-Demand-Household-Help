import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import { formatDisplayId, formatPeso } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { refundOrVoidPayment, createCompletionInvoice, settlePlatformFundedPayment } from '@services/paymentLifecycleService';
import { freeSlot } from '@services/workerAvailabilityService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const RESOLVE_ACTIONS = [
  'APPROVE_QUOTE',
  'REQUEST_NEW_QUOTE',
  'CANCEL_BOOKING',
  // Post-completion non-payment (the 72h auto-escalation case: the worker
  // did the job, the client never paid). Neither fits the fixed
  // RESOLVED_STATUS_BY_ACTION lookup below — their outcome depends on what
  // actually happens (self-heal vs. genuinely unpaid) — so they're handled
  // in a separate branch of resolveDispute.
  'RESOLVE_FOR_WORKER',
  'PAY_WORKER_FROM_PLATFORM',
] as const;
type ResolveAction = (typeof RESOLVE_ACTIONS)[number];

const RESOLVED_STATUS_BY_ACTION = {
  APPROVE_QUOTE: 'RESOLVED_APPROVED',
  REQUEST_NEW_QUOTE: 'RESOLVED_NEW_QUOTE_REQUESTED',
  CANCEL_BOOKING: 'RESOLVED_CANCELLED',
} as const satisfies Partial<Record<ResolveAction, string>>;

export const disputeInclude = {
  booking: {
    include: {
      client: { select: { id: true, fullName: true } },
      worker: { select: { id: true, fullName: true } },
      payment: { select: { id: true, status: true, escrowStatus: true } },
      arrivalVerification: true,
    },
  },
} satisfies Prisma.DisputeInclude;

export type DisputeRecord = Prisma.DisputeGetPayload<{ include: typeof disputeInclude }>;

export function formatDispute(record: DisputeRecord) {
  const booking = record.booking;
  const amount = booking.finalPrice ?? booking.estimatedPrice ?? null;

  return {
    id: record.id,
    bookingId: booking.id,
    displayId: formatDisplayId(booking.id),
    // Lets the admin UI show RESOLVE_FOR_WORKER / PAY_WORKER_FROM_PLATFORM
    // only for a completed-but-unpaid job (AWAITING_PAYMENT) — those two
    // actions are rejected server-side for any other booking status anyway,
    // this just keeps the buttons from being offered when they'd just 409.
    bookingStatus: booking.status,
    client: booking.client?.fullName ?? '—',
    clientId: booking.client?.id ?? null,
    worker: booking.worker?.fullName ?? '—',
    workerId: booking.worker?.id ?? null,
    amount: amount != null ? formatPeso(amount) : '—',
    reason: record.reason,
    evidenceUrls: record.evidenceUrls,
    status: record.status,
    resolution: record.resolution,
    resolvedById: record.resolvedById,
    resolvedAt: record.resolvedAt,
    refundStatus: record.refundStatus,
    refundFailureReason: record.refundFailureReason,
    // The worker's GPS check-in record for this booking, if one exists —
    // lets an admin cross-reference a fraud claim ("worker never showed up")
    // against the same arrival data the geofence check itself already
    // enforced, instead of taking either party's word for it.
    arrival: booking.arrivalVerification
      ? {
          distanceMeters: Math.round(booking.arrivalVerification.distanceMeters),
          isVerified: booking.arrivalVerification.isVerified,
          isOutsideBookedWindow: booking.arrivalVerification.isOutsideBookedWindow,
          mockedLocation: booking.arrivalVerification.mockedLocation,
          checkedInAt: booking.arrivalVerification.createdAt,
        }
      : null,
    // Raw hours open — lets the admin UI surface "been open 3 days" style
    // urgency instead of just a date, especially useful once sorted
    // oldest-first (see listDisputes). Still meaningful for a resolved
    // dispute (how long it took), so always computed, not just for OPEN.
    ageHours: Math.round((Date.now() - record.createdAt.getTime()) / (60 * 60 * 1000)),
    createdAt: record.createdAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}

function buildDisputeWhere(search: string, status: string): Prisma.DisputeWhereInput {
  const where: Prisma.DisputeWhereInput = {};

  // Pseudo-status, not a real Dispute.status value — the admin dispute list's
  // dedicated queue for resolved-but-unrefunded cases (see resolveDispute's
  // refundStatus tracking). Kept out of the normal status filter so it reads
  // the same way from the query string without a separate endpoint.
  if (status === 'NEEDS_REFUND_REVIEW') {
    where.refundStatus = 'FAILED';
  } else if (status === 'OPEN') {
    // The admin "Open" queue means "not yet resolved", which now spans two
    // real statuses: OPEN (nobody's looked at it) and UNDER_REVIEW (an admin
    // opened it via getDisputeById but hasn't resolved it yet). Without this
    // a dispute would silently vanish from the queue the moment an admin
    // viewed it, well before anyone actually resolved anything.
    where.status = { in: ['OPEN', 'UNDER_REVIEW'] };
  } else if (status && status !== 'all') {
    where.status = status.toUpperCase();
  }

  if (search) {
    where.OR = [
      { bookingId: { contains: search } },
      { reason: { contains: search } },
      { booking: { client: { fullName: { contains: search } } } },
      { booking: { worker: { fullName: { contains: search } } } },
    ];
  }

  return where;
}

/**
 * GET /api/admin/disputes?status=OPEN|UNDER_REVIEW|RESOLVED_*|REJECTED|all
 */
export const listDisputes = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';

    const where = buildDisputeWhere(search, status);

    // The OPEN queue is a worklist, not a browsing history — oldest-first
    // so an admin naturally clears the longest-waiting dispute first
    // instead of it silently sinking behind newer ones (see also
    // bookingWorker.escalateStaleDisputes' SLA reminders). Every other view
    // (Resolved, Refund Failed, all) stays newest-first.
    const orderBy = status === 'OPEN' ? ({ createdAt: 'asc' } as const) : ({ createdAt: 'desc' } as const);

    const [total, records] = await Promise.all([
      prisma.dispute.count({ where }),
      prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: disputeInclude,
      }),
    ]);

    return res.json({
      success: true,
      data: records.map(formatDispute),
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('List disputes error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

const DISPUTE_HISTORY_WINDOW_DAYS = 90;

/**
 * GET /api/admin/disputes/history/:userId
 * Fraud-review signal: how often this user (as either the client or the
 * worker on the underlying booking) has been party to a dispute — repeat
 * appearances are the actual fraud pattern to watch for, more than any
 * single dispute's evidence on its own. `raisedByThisUser` on each recent
 * entry distinguishes "filed it" from "was disputed against".
 */
export const getDisputeHistoryForUser = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const since = new Date(Date.now() - DISPUTE_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const where: Prisma.DisputeWhereInput = {
      booking: { OR: [{ clientId: userId }, { workerId: userId }] },
    };

    const [totalDisputes, disputesLast90Days, records] = await Promise.all([
      prisma.dispute.count({ where }),
      prisma.dispute.count({ where: { ...where, createdAt: { gte: since } } }),
      prisma.dispute.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: disputeInclude,
      }),
    ]);

    return res.json({
      success: true,
      data: {
        userId,
        totalDisputes,
        disputesLast90Days,
        recent: records.map((r) => ({ ...formatDispute(r), raisedByThisUser: r.raisedById === userId })),
      },
    });
  } catch (error) {
    console.error('Get dispute history error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getDisputeById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    let record = await prisma.dispute.findUnique({ where: { id }, include: disputeInclude });
    if (!record) {
      return res.status(404).json(errorResponse(404, 'Dispute not found'));
    }

    // An admin opening a specific dispute is what "starts" the review —
    // flips it out of the raw, untouched OPEN queue into UNDER_REVIEW so the
    // dispute list can distinguish "nobody has looked at this yet" from
    // "someone's actively working it". Only fires once, from OPEN; already
    // UNDER_REVIEW / resolved / rejected disputes are left alone.
    if (record.status === 'OPEN') {
      record = await prisma.dispute.update({
        where: { id },
        data: { status: 'UNDER_REVIEW' },
        include: disputeInclude,
      });
    }

    return res.json({ success: true, data: formatDispute(record) });
  } catch (error) {
    console.error('Get dispute error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/**
 * Handles RESOLVE_FOR_WORKER and PAY_WORKER_FROM_PLATFORM — split out of
 * resolveDispute because both call into paymentLifecycleService functions
 * that manage their own transactions (nesting them inside resolveDispute's
 * existing $transaction block isn't workable), and because their resulting
 * Dispute.status depends on what actually happens rather than a fixed
 * action->status lookup.
 */
async function resolveNonPaymentDispute(
  req: AuthRequest,
  res: Response,
  params: {
    disputeId: string;
    booking: { id: string; clientId: string; workerId: string | null };
    adminId: string | undefined;
    action: 'RESOLVE_FOR_WORKER' | 'PAY_WORKER_FROM_PLATFORM';
    resolution: string | undefined;
  }
) {
  const { disputeId, booking, adminId, action, resolution } = params;

  try {
    let disputeStatus: string;
    let disputeResolutionNote: string;
    let notifyWorkerMessage: string;

    if (action === 'PAY_WORKER_FROM_PLATFORM') {
      await settlePlatformFundedPayment(booking.id);
      disputeStatus = 'RESOLVED_PLATFORM_PAID';
      disputeResolutionNote = resolution!.trim();
      notifyWorkerMessage = `Booking ${formatDisplayId(booking.id)}: the platform has settled your earnings directly since the client's payment could not be collected.`;

      await writeAuditLog({
        actorId: adminId,
        actorName: req.user?.email,
        actorRole: req.user?.role,
        action: 'PLATFORM_FUNDED_PAYMENT',
        category: 'ADMIN_ACTION',
        level: 'WARN',
        message: `Booking ${formatDisplayId(booking.id)} settled with platform funds (client never paid): ${disputeResolutionNote}`,
        metadata: { disputeId, bookingId: booking.id },
      });
    } else {
      const result = await createCompletionInvoice(booking.id);

      if ('alreadyPaid' in result) {
        // Xendit already showed the invoice PAID — a missed webhook, not a
        // real non-payment. createCompletionInvoice's own self-heal path
        // already finalized the booking and settled the worker.
        disputeStatus = 'RESOLVED_PAID';
        disputeResolutionNote = resolution?.trim() || 'Payment had already been received (missed webhook) — settled normally.';
        notifyWorkerMessage = `Booking ${formatDisplayId(booking.id)}: the client's payment had already gone through — it just hadn't been recorded yet.`;
      } else {
        // Still genuinely unpaid — hold the client's account so they can't
        // strand another worker while this stays outstanding, and give them
        // one more explicit chance via the (possibly freshly re-minted)
        // checkout link. The existing invoice-paid webhook path clears the
        // hold automatically the moment they do pay (finalizePaidBooking).
        await prisma.clientProfile.updateMany({
          where: { userId: booking.clientId },
          data: {
            paymentHoldAt: new Date(),
            paymentHoldNote: `Unpaid booking ${formatDisplayId(booking.id)} (₱${result.amount.toFixed(2)}) — dispute resolved in the worker's favor by an admin`,
            outstandingBalance: result.amount,
          },
        });

        await notifyUser({
          userId: booking.clientId,
          type: 'PAYMENT_REMINDER',
          title: 'Payment required — account on hold',
          message: `An admin reviewed booking ${formatDisplayId(booking.id)} and confirmed the job was completed. Your account is on hold until you pay ₱${result.amount.toFixed(2)}: ${result.checkoutUrl}`,
          relatedId: booking.id,
        });

        disputeStatus = 'RESOLVED_WORKER_PROTECTED';
        disputeResolutionNote =
          resolution?.trim() || "Confirmed the worker completed the job; client's account placed on hold pending payment.";
        notifyWorkerMessage = `Booking ${formatDisplayId(booking.id)}: we confirmed your completed job and put the client's account on hold until they pay. You'll be notified once it's settled.`;
      }

      await writeAuditLog({
        actorId: adminId,
        actorName: req.user?.email,
        actorRole: req.user?.role,
        action: 'DISPUTE_RESOLVED',
        category: 'ADMIN_ACTION',
        message: `Dispute for booking ${formatDisplayId(booking.id)} resolved via RESOLVE_FOR_WORKER (${disputeStatus})`,
        metadata: { disputeId, bookingId: booking.id },
      });
    }

    await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: disputeStatus,
        resolution: disputeResolutionNote,
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });

    if (booking.workerId) {
      await notifyUser({
        userId: booking.workerId,
        type: 'DISPUTE_RESOLVED',
        title: 'Dispute Resolved',
        message: `${notifyWorkerMessage} Admin note: ${disputeResolutionNote}`,
        relatedId: booking.id,
      });
    }

    const updated = await prisma.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: disputeInclude });
    return res.json({ success: true, data: formatDispute(updated) });
  } catch (error: any) {
    console.error('Resolve non-payment dispute error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
}

/**
 * PATCH /api/admin/disputes/:id/resolve
 * Body: { action: ResolveAction, resolution?: string }
 *
 *  - APPROVE_QUOTE: proceeds the booking to QUOTE_APPROVED (final price =
 *    laborCost + materialsCost) and re-affirms the payment hold — the actual
 *    capture still happens at confirm-completion, matching the normal
 *    non-disputed quote-approval flow.
 *  - REQUEST_NEW_QUOTE: resets quoteStatus to PENDING and sends the booking
 *    back to IN_PROGRESS so the worker can resubmit via POST .../quote.
 *  - CANCEL_BOOKING: cancels the booking, writes a Cancellation record, and
 *    releases/refunds the held escrow.
 *  - RESOLVE_FOR_WORKER: for a completed job the client never paid for
 *    (booking stuck AWAITING_PAYMENT). Confirms the worker's claim, makes
 *    one more collection attempt (re-surfacing or re-minting the Xendit
 *    checkout link — self-heals if Xendit shows it already paid, e.g. a
 *    missed webhook), and if still unpaid puts the client's account on hold
 *    via ClientProfile.paymentHoldAt until they pay or an admin releases it.
 *  - PAY_WORKER_FROM_PLATFORM: explicit override for when collection is a
 *    lost cause — the platform settles the worker's earnings out of its own
 *    funds. Requires RESOLVE_FOR_WORKER to have run first (so a Payment row
 *    exists) and a substantive reason; always audit-logged at WARN.
 */
export const resolveDispute = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { action, resolution } = req.body as { action?: string; resolution?: string };
    const adminId = req.user?.userId;

    if (!action || !RESOLVE_ACTIONS.includes(action as ResolveAction)) {
      return res.status(400).json(errorResponse(400, `action must be one of: ${RESOLVE_ACTIONS.join(', ')}`));
    }

    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: { booking: true },
    });

    if (!dispute) {
      return res.status(404).json(errorResponse(404, 'Dispute not found'));
    }

    if (dispute.status !== 'OPEN' && dispute.status !== 'UNDER_REVIEW') {
      return res.status(409).json(errorResponse(409, `Dispute already resolved (${dispute.status})`));
    }

    const booking = dispute.booking;
    const isPaymentAction = action === 'RESOLVE_FOR_WORKER' || action === 'PAY_WORKER_FROM_PLATFORM';

    // Quote actions only make sense on a quote dispute; CANCEL_BOOKING can also
    // resolve a payment-overdue or refund-request dispute (booking still in
    // PENDING_COMPLETION / AWAITING_PAYMENT / COMPLETED); the payment actions
    // only make sense on a completed-but-unpaid job.
    if (isPaymentAction) {
      if (booking.status !== 'AWAITING_PAYMENT') {
        return res.status(409).json(
          errorResponse(409, `${action} only applies to a completed job still awaiting payment (booking is ${booking.status})`)
        );
      }
      if (action === 'PAY_WORKER_FROM_PLATFORM' && (!resolution || resolution.trim().length < 20)) {
        return res.status(400).json(
          errorResponse(400, 'PAY_WORKER_FROM_PLATFORM requires a detailed reason (20+ characters) — this is a real platform expense.')
        );
      }
      return resolveNonPaymentDispute(req, res, { disputeId: id, booking, adminId, action, resolution });
    }
    if (action !== 'CANCEL_BOOKING' && booking.status !== 'DISPUTED') {
      return res.status(409).json(errorResponse(409, 'Booking is not currently disputed'));
    }
    if (
      action === 'CANCEL_BOOKING' &&
      !['DISPUTED', 'PENDING_COMPLETION', 'AWAITING_PAYMENT', 'COMPLETED'].includes(booking.status)
    ) {
      return res.status(409).json(errorResponse(409, `Cannot resolve — booking is ${booking.status}`));
    }

    const resolvedStatus = RESOLVED_STATUS_BY_ACTION[action as keyof typeof RESOLVED_STATUS_BY_ACTION];
    // A COMPLETED booking stays COMPLETED — we refund without un-completing it.
    const cancelKeepsStatus = action === 'CANCEL_BOOKING' && booking.status === 'COMPLETED';

    await prisma.$transaction(async (tx) => {
      if (action === 'APPROVE_QUOTE') {
        if (booking.laborCost == null || booking.materialsCost == null) {
          throw new Error('NO_QUOTE');
        }
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'QUOTE_APPROVED',
            quoteStatus: 'APPROVED',
            approvedAt: new Date(),
            finalPrice: booking.laborCost + booking.materialsCost,
            disputeResolvedById: adminId,
            disputeResolvedAt: new Date(),
          },
        });
      } else if (action === 'REQUEST_NEW_QUOTE') {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'IN_PROGRESS',
            quoteStatus: 'PENDING',
            laborCost: null,
            materialsCost: null,
            quoteNotes: null,
            quotedAt: null,
            disputeResolvedById: adminId,
            disputeResolvedAt: new Date(),
          },
        });
      } else {
        // A dispute raised pre-completion (QUOTE_SUBMITTED -> DISPUTED) still
        // holds the worker's capacity slot and calendar slot — completeBooking
        // never ran for this booking, so nothing has freed them yet. A dispute
        // raised post-completion (AWAITING_PAYMENT -> DISPUTED, e.g. payment
        // overdue) already had both freed there (workerCompletedAt is set), so
        // skip here to avoid double-freeing capacity that isn't actually held.
        if (!cancelKeepsStatus && booking.workerId && !booking.workerCompletedAt) {
          const workerProfile = await tx.workerProfile.update({
            where: { userId: booking.workerId },
            data: { activeJobCount: { decrement: 1 } },
          });
          if (booking.timeSlot) {
            await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot, booking.estimatedDurationHours);
          }

          // Same cleanup bookingController.cancelBooking/completeBooking do —
          // a dispute resolved into CANCELLED is another path that can end a
          // booking, and without this its /extend-reserved future calendar
          // block (see bookingController.extendBooking) would survive it.
          await tx.workerAvailability.updateMany({
            where: { workerProfileId: workerProfile.id, blockedByBookingId: booking.id, isBooked: false },
            data: { isBlocked: false, blockedByBookingId: null },
          });
        }

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            ...(cancelKeepsStatus ? {} : { status: 'CANCELLED' }),
            disputeResolvedById: adminId,
            disputeResolvedAt: new Date(),
          },
        });
        if (!cancelKeepsStatus) {
          await tx.cancellation.create({
            data: {
              bookingId: booking.id,
              cancelledBy: 'ADMIN',
              cancelledById: adminId ?? 'system',
              reason: resolution?.trim() || 'Cancelled via dispute resolution',
            },
          });
        }
      }

      await tx.dispute.update({
        where: { id },
        data: {
          status: resolvedStatus,
          resolution: resolution?.trim() || null,
          resolvedById: adminId,
          resolvedAt: new Date(),
        },
      });
    });

    // Refund/void outcome, tracked separately from the dispute's own
    // resolution — the booking-cancel transaction above already committed
    // regardless of what happens here, since a downstream payment-gateway
    // failure shouldn't block the booking itself from being cancelled. What
    // must never happen again is this failing silently: previously a thrown
    // error here (Xendit refund rejected, or "payout already sent, needs a
    // manual clawback") was caught and only console.error'd, while the API
    // still reported success and nothing else in the system ever surfaced
    // that the client's money never actually moved.
    let refundStatus: 'NOT_APPLICABLE' | 'SUCCEEDED' | 'FAILED' = 'NOT_APPLICABLE';
    let refundFailureReason: string | null = null;
    let refundAmount: number | null = null;

    if (action === 'CANCEL_BOOKING') {
      try {
        const refundedPayment = await refundOrVoidPayment(
          booking.id,
          resolution?.trim() || 'Cancelled via dispute resolution'
        );
        refundStatus = 'SUCCEEDED';
        refundAmount = refundedPayment?.capturedAmount ?? refundedPayment?.totalAmount ?? null;
      } catch (error: any) {
        refundStatus = 'FAILED';
        refundFailureReason = error?.message || 'Unknown error';

        await writeAuditLog({
          actorId: adminId,
          actorName: req.user?.email,
          actorRole: req.user?.role,
          action: 'DISPUTE_REFUND_FAILED',
          category: 'ADMIN_ACTION',
          level: 'ERROR',
          message: `Refund/void failed while resolving dispute ${id} for booking ${formatDisplayId(booking.id)}: ${refundFailureReason}`,
          metadata: { disputeId: id, bookingId: booking.id },
        });

        const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
        await Promise.all(
          admins.map((admin) =>
            notifyUser({
              userId: admin.id,
              type: 'REFUND_FAILED',
              title: 'Refund failed — manual action needed',
              message: `Booking ${formatDisplayId(booking.id)} was cancelled via dispute resolution, but the refund/void failed: ${refundFailureReason}`,
              relatedId: booking.id,
            })
          )
        );
      }

      await prisma.dispute.update({
        where: { id },
        data: { refundStatus, refundFailureReason, refundAmount },
      });
    }

    await writeAuditLog({
      actorId: adminId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'DISPUTE_RESOLVED',
      category: 'ADMIN_ACTION',
      message: `Dispute for booking ${formatDisplayId(booking.id)} resolved via ${action}`,
    });

    const resolutionNote = resolution?.trim();
    const partiesToNotify = [booking.clientId, booking.workerId].filter((v): v is string => Boolean(v));
    await Promise.all(
      partiesToNotify.map((userId) =>
        notifyUser({
          userId,
          type: 'DISPUTE_RESOLVED',
          title: 'Dispute Resolved',
          message: `Your dispute for booking ${formatDisplayId(booking.id)} was resolved: ${action.replace(/_/g, ' ').toLowerCase()}.${
            resolutionNote ? ` Admin note: ${resolutionNote}` : ''
          }`,
          relatedId: booking.id,
        })
      )
    );

    const updated = await prisma.dispute.findUniqueOrThrow({ where: { id }, include: disputeInclude });
    return res.json({ success: true, data: formatDispute(updated) });
  } catch (error: any) {
    if (error.message === 'NO_QUOTE') {
      return res.status(400).json(errorResponse(400, 'No quote exists on this booking to approve'));
    }
    console.error('Resolve dispute error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
