import { Request, Response } from 'express';
import prisma from '@config/database';
import { postCancellationFee } from '@services/ledgerService';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import { formatDisplayId } from '@utils/formatters';
import { getAppSettings } from '@services/appSettingsService';
import { chargePenaltyTx, creditCompensationTx } from '@services/debtLedgerService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// A worker who cancels a job AFTER arriving must upload proof and say whose
// fault it was (bookingController.cancelBooking). A worker-fault cancel is
// penalized on the spot; a client-fault claim waits here for an admin to
// check the proof:
//   APPROVE — the client owes the cancellation fee (their account is put on
//             hold until it's settled, same as an unpaid booking) and the
//             worker is compensated (against their dues first, the rest on
//             their next payout — see debtLedgerService.creditCompensationTx).
//   REJECT  — the proof doesn't hold up, so it's treated as the worker's
//             fault: the no-show penalty applies.

const REVIEW_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;

/**
 * GET /api/admin/cancellations?status=PENDING_REVIEW
 * On-site cancellations with the worker's proof. status=ALL lists every
 * cancellation that went through review.
 */
export const listCancellationReviews = async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING_REVIEW';
    if (raw !== 'ALL' && !REVIEW_STATUSES.includes(raw as (typeof REVIEW_STATUSES)[number])) {
      return res.status(400).json(errorResponse(400, `status must be ALL or one of ${REVIEW_STATUSES.join(', ')}`));
    }

    const rows = await prisma.cancellation.findMany({
      where: raw === 'ALL' ? { compensationStatus: { in: [...REVIEW_STATUSES] } } : { compensationStatus: raw },
      include: {
        booking: {
          select: {
            id: true,
            scheduledDate: true,
            scheduledTime: true,
            serviceType: true,
            location: true,
            workerArrivedAt: true,
            serviceTask: { select: { name: true } },
            client: { select: { id: true, fullName: true, email: true, phone: true } },
            worker: { select: { id: true, fullName: true, email: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return res.json({
      success: true,
      data: rows.map((c) => ({
        bookingId: c.bookingId,
        displayId: formatDisplayId(c.bookingId),
        service: c.booking.serviceTask?.name ?? c.booking.serviceType,
        scheduledDate: c.booking.scheduledDate,
        scheduledTime: c.booking.scheduledTime,
        location: c.booking.location,
        workerArrivedAt: c.booking.workerArrivedAt,
        client: c.booking.client,
        worker: c.booking.worker,
        reason: c.reason,
        proofUrls: c.proofUrls,
        compensationAmount: c.compensationAmount,
        compensationStatus: c.compensationStatus,
        reviewNote: c.reviewNote,
        reviewedAt: c.reviewedAt,
        cancelledAt: c.createdAt,
      })),
    });
  } catch (error) {
    console.error('List cancellation reviews error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/**
 * PATCH /api/admin/cancellations/:bookingId/review
 * Body: { decision: 'APPROVE' | 'REJECT', note } — see the header comment.
 */
export const reviewCancellation = async (req: AuthRequest, res: Response) => {
  try {
    const bookingId = req.params.bookingId as string;
    const { decision, note } = req.body as { decision?: string; note?: string };
    const adminId = req.user?.userId;

    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      return res.status(400).json(errorResponse(400, 'decision must be APPROVE or REJECT'));
    }
    if (typeof note !== 'string' || note.trim().length < 10) {
      return res.status(400).json(errorResponse(400, 'Add a note explaining the decision (at least 10 characters)'));
    }

    const cancellation = await prisma.cancellation.findUnique({
      where: { bookingId },
      include: { booking: { select: { clientId: true, workerId: true } } },
    });
    if (!cancellation) {
      return res.status(404).json(errorResponse(404, 'Cancellation not found'));
    }
    if (cancellation.compensationStatus !== 'PENDING_REVIEW') {
      return res.status(409).json(errorResponse(409, 'This cancellation was already reviewed'));
    }
    const { clientId, workerId } = cancellation.booking;
    if (!workerId) {
      return res.status(409).json(errorResponse(409, 'This booking has no worker'));
    }

    const settings = await getAppSettings();
    const amount = cancellation.compensationAmount ?? settings.clientFaultCompensationAmount;
    const penalty = settings.noShowPenaltyAmount;
    const displayId = formatDisplayId(bookingId);

    await prisma.$transaction(async (tx) => {
      // Status-guarded so two admins can't both decide it.
      const claim = await tx.cancellation.updateMany({
        where: { bookingId, compensationStatus: 'PENDING_REVIEW' },
        data: {
          compensationStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          reviewedById: adminId ?? null,
          reviewedAt: new Date(),
          reviewNote: note.trim(),
          ...(decision === 'REJECT'
            ? { fault: 'WORKER', penalizedWorkerId: workerId, penaltyAmount: penalty > 0 ? penalty : null }
            : {}),
        },
      });
      if (claim.count === 0) throw new Error('ALREADY_REVIEWED');

      const workerProfile = await tx.workerProfile.findUniqueOrThrow({ where: { userId: workerId }, select: { id: true } });

      if (decision === 'APPROVE') {
        const client = await tx.clientProfile.findUnique({ where: { userId: clientId }, select: { outstandingBalance: true } });
        await tx.clientProfile.update({
          where: { userId: clientId },
          data: {
            outstandingBalance: (client?.outstandingBalance ?? 0) + amount,
            paymentHoldAt: new Date(),
            paymentHoldNote: `Cancellation fee ₱${amount.toFixed(2)} for booking ${displayId}`,
          },
        });
        await creditCompensationTx(tx, workerProfile.id, amount, {
          bookingId,
          note: `Compensation for client-caused cancellation of ${displayId}`,
        });
        await postCancellationFee(tx, clientId, workerId, amount, { key: bookingId, bookingId });
      } else if (penalty > 0) {
        await chargePenaltyTx(tx, workerProfile.id, penalty, {
          bookingId,
          note: `Cancellation proof for ${displayId} was not accepted`,
        });
      }
    });

    if (decision === 'APPROVE') {
      await notifyUser({
        userId: clientId,
        type: 'CANCELLATION_COMPENSATION',
        title: 'Cancellation fee',
        message: `We reviewed the cancellation of booking ${displayId} and found it was caused on your side. A ₱${amount.toFixed(2)} fee applies, and new bookings are paused until it's settled — contact support to pay. Note: ${note.trim()}`,
        relatedId: bookingId,
      });
      await notifyUser({
        userId: workerId,
        type: 'CANCELLATION_COMPENSATION',
        title: 'Compensation approved',
        message: `Your proof for booking ${displayId} was accepted. You'll receive ₱${amount.toFixed(2)} (applied to any dues first, the rest with your next payout).`,
        relatedId: bookingId,
      });
    } else {
      await notifyUser({
        userId: workerId,
        type: 'CANCELLATION_PENALTY',
        title: 'Cancellation proof not accepted',
        message: `We reviewed your cancellation of booking ${displayId} and couldn't confirm it was the client's fault.${penalty > 0 ? ` A ₱${penalty.toFixed(2)} penalty was added to your platform dues.` : ''} Note: ${note.trim()}`,
        relatedId: bookingId,
      });
    }

    await writeAuditLog({
      actorId: adminId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: decision === 'APPROVE' ? 'CANCELLATION_COMPENSATION_APPROVED' : 'CANCELLATION_COMPENSATION_REJECTED',
      category: 'ADMIN_ACTION',
      message: `On-site cancellation of ${displayId} reviewed: ${decision === 'APPROVE' ? 'client at fault' : 'worker at fault'} — ${note.trim()}`,
      metadata: { bookingId, decision, amount: decision === 'APPROVE' ? amount : penalty },
    });

    return res.json({ success: true, message: decision === 'APPROVE' ? 'Compensation approved' : 'Claim rejected — penalty applied' });
  } catch (error: any) {
    if (error?.message === 'ALREADY_REVIEWED') {
      return res.status(409).json(errorResponse(409, 'This cancellation was already reviewed'));
    }
    console.error('Review cancellation error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
