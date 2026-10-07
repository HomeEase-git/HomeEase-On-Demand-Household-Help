import prisma from '@config/database';
import type { RefundRequest, RefundRequestSource } from '@prisma/client';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import { formatDisplayId } from '@utils/formatters';
import {
  refundOrVoidPayment,
  voidUnpaidPayment,
  stopWorkerPayout,
  undoWorkerSettlement,
  flagTaxRecordsForRefundedPayment,
  PayoutAlreadySentError,
} from '@services/paymentLifecycleService';
import { postManualRefund } from '@services/ledgerService';

/**
 * Money that was actually paid is never refunded automatically: anything that
 * would refund a paid booking (a cancellation, an admin force-cancel, a
 * dispute resolved with Cancel & Refund) files a RefundRequest instead, and an
 * admin approves, rejects, or records it as refunded manually. Voiding an
 * unpaid payment still happens right away — no money has moved.
 */

export class RefundRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
  }
}

export type RefundOutcome =
  | { kind: 'none' } // nothing was paid
  | { kind: 'voided' } // unpaid payment voided, nothing to refund
  | { kind: 'requested'; request: RefundRequest }; // waiting for an admin

export async function requestRefund(input: {
  bookingId: string;
  reason: string;
  source: RefundRequestSource;
  requestedById?: string | null;
  disputeId?: string | null;
}): Promise<RefundOutcome> {
  const payment = await prisma.payment.findUnique({ where: { bookingId: input.bookingId } });
  if (!payment) return { kind: 'none' };

  if (payment.status === 'PENDING') {
    await voidUnpaidPayment(input.bookingId, input.reason);
    return { kind: 'voided' };
  }
  if (payment.status !== 'COMPLETED') return { kind: 'none' };

  // One open request per payment: lock the payment row so two cancellations
  // at once can't file two requests.
  const { request, created } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`;
    const open = await tx.refundRequest.findFirst({
      where: { paymentId: payment.id, status: { in: ['PENDING', 'FAILED'] } },
    });
    if (open) {
      const linked =
        input.disputeId && !open.disputeId
          ? await tx.refundRequest.update({ where: { id: open.id }, data: { disputeId: input.disputeId } })
          : open;
      return { request: linked, created: false };
    }
    const fresh = await tx.refundRequest.create({
      data: {
        paymentId: payment.id,
        bookingId: input.bookingId,
        disputeId: input.disputeId ?? null,
        amount: payment.capturedAmount ?? payment.totalAmount,
        reason: input.reason,
        source: input.source,
        requestedById: input.requestedById ?? null,
      },
    });
    return { request: fresh, created: true };
  });

  if (created) {
    await writeAuditLog({
      actorId: input.requestedById ?? undefined,
      action: 'REFUND_REQUESTED',
      category: 'STATUS_CHANGE',
      message: `Refund of ₱${request.amount.toFixed(2)} for booking ${formatDisplayId(input.bookingId)} is waiting for admin approval (${input.source}): ${input.reason}`,
      metadata: { refundRequestId: request.id, bookingId: input.bookingId, paymentId: payment.id },
    });
    await notifyAdmins(
      'Refund waiting for approval',
      `Booking ${formatDisplayId(input.bookingId)}: ₱${request.amount.toFixed(2)} — ${input.reason}`,
      input.bookingId
    );
  }
  return { kind: 'requested', request };
}

/**
 * Approves a PENDING (or retries a FAILED) request and sends the refund. The
 * status claim means two admins clicking at once only refund once. If the
 * refund can't go through, the request is FAILED with the reason — when the
 * worker's payout was already sent, the admin settles it and uses
 * markRefundedManually.
 */
export async function approveRefundRequest(id: string, adminId: string, note?: string | null) {
  const claim = await prisma.refundRequest.updateMany({
    where: { id, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'APPROVED', decidedById: adminId, decidedAt: new Date(), decisionNote: note ?? null, failureReason: null },
  });
  if (claim.count === 0) throw await notDecidable(id);
  const request = await prisma.refundRequest.findUniqueOrThrow({ where: { id } });

  try {
    const payment = await refundOrVoidPayment(request.bookingId, request.reason);
    await syncDispute(request, {
      refundStatus: 'SUCCEEDED',
      refundFailureReason: null,
      refundAmount: payment?.capturedAmount ?? payment?.totalAmount ?? request.amount,
    });
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : 'Unknown error';
    await prisma.refundRequest.update({ where: { id }, data: { status: 'FAILED', failureReason } });
    await syncDispute(request, { refundStatus: 'FAILED', refundFailureReason: failureReason });
    await writeAuditLog({
      actorId: adminId,
      action: 'REFUND_FAILED',
      category: 'ADMIN_ACTION',
      level: 'ERROR',
      message: `Approved refund for booking ${formatDisplayId(request.bookingId)} did not go through: ${failureReason}`,
      metadata: { refundRequestId: id, bookingId: request.bookingId, payoutAlreadySent: error instanceof PayoutAlreadySentError },
    });
    return prisma.refundRequest.findUniqueOrThrow({ where: { id } });
  }

  await writeAuditLog({
    actorId: adminId,
    action: 'REFUND_APPROVED',
    category: 'ADMIN_ACTION',
    message: `Admin approved the ₱${request.amount.toFixed(2)} refund for booking ${formatDisplayId(request.bookingId)}${note ? `: ${note}` : ''}`,
    metadata: { refundRequestId: id, bookingId: request.bookingId },
  });
  await notifyClient(request, 'REFUND_APPROVED', 'Refund approved', `Your refund of ₱${request.amount.toFixed(2)} has been approved and is on its way.`);
  return prisma.refundRequest.findUniqueOrThrow({ where: { id } });
}

export async function rejectRefundRequest(id: string, adminId: string, note: string) {
  const claim = await prisma.refundRequest.updateMany({
    where: { id, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'REJECTED', decidedById: adminId, decidedAt: new Date(), decisionNote: note },
  });
  if (claim.count === 0) throw await notDecidable(id);
  const request = await prisma.refundRequest.findUniqueOrThrow({ where: { id } });

  await syncDispute(request, { refundStatus: 'REJECTED', refundFailureReason: note });
  await writeAuditLog({
    actorId: adminId,
    action: 'REFUND_REJECTED',
    category: 'ADMIN_ACTION',
    message: `Admin rejected the ₱${request.amount.toFixed(2)} refund for booking ${formatDisplayId(request.bookingId)}: ${note}`,
    metadata: { refundRequestId: id, bookingId: request.bookingId },
  });
  await notifyClient(request, 'REFUND_REJECTED', 'Refund not approved', `Your refund request was not approved: ${note}`);
  return request;
}

/**
 * Records a refund the admin settled outside the app (typically because the
 * worker's payout was already sent). The payment is marked refunded for the
 * books; a payout that hasn't gone out yet is still stopped so the worker
 * isn't paid on top. Recovering money from a worker who was already paid is
 * done with Adjust Dues on the worker's page.
 */
export async function markRefundedManually(id: string, adminId: string, note: string) {
  const request = await prisma.refundRequest.findUnique({ where: { id } });
  if (!request) throw new RefundRequestError('Refund request not found', 404);
  if (request.status !== 'PENDING' && request.status !== 'FAILED') throw await notDecidable(id);

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: request.paymentId },
    include: { booking: { select: { workerId: true, clientId: true } } },
  });
  let workerAlreadyPaid = false;
  if (payment.status === 'COMPLETED' && payment.methodType !== 'CASH') {
    try {
      await stopWorkerPayout(payment.id, request.bookingId, `Refunded manually: ${note}`);
      await undoWorkerSettlement(payment.id);
    } catch (error) {
      workerAlreadyPaid = error instanceof PayoutAlreadySentError;
      // Already sent is the usual reason for a manual refund; anything else
      // (a payout mid-send) should be retried rather than recorded.
      if (!(error instanceof PayoutAlreadySentError)) {
        throw new RefundRequestError(error instanceof Error ? error.message : 'Could not stop the payout', 409);
      }
    }
  }

  const claim = await prisma.refundRequest.updateMany({
    where: { id, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'REFUNDED_MANUALLY', decidedById: adminId, decidedAt: new Date(), decisionNote: note, failureReason: null },
  });
  if (claim.count === 0) throw await notDecidable(id);

  if (payment.status === 'COMPLETED') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'REFUNDED',
        escrowStatus: 'REFUNDED',
        refundReason: `Refunded manually by admin: ${note}`,
        refundedAt: new Date(),
      },
    });
    await flagTaxRecordsForRefundedPayment(payment);
    // Cash jobs never had the client's money on the platform's books.
    if (payment.methodType !== 'CASH') {
      await postManualRefund(prisma, payment, payment.booking.workerId, workerAlreadyPaid, payment.booking.clientId);
    }
  }

  await syncDispute(request, { refundStatus: 'SUCCEEDED', refundFailureReason: null, refundAmount: request.amount });
  await writeAuditLog({
    actorId: adminId,
    action: 'REFUND_MARKED_MANUAL',
    category: 'ADMIN_ACTION',
    message: `Admin recorded the ₱${request.amount.toFixed(2)} refund for booking ${formatDisplayId(request.bookingId)} as done manually: ${note}`,
    metadata: { refundRequestId: id, bookingId: request.bookingId },
  });
  await notifyClient(request, 'REFUND_APPROVED', 'Refund processed', `Your refund of ₱${request.amount.toFixed(2)} has been processed.`);
  return prisma.refundRequest.findUniqueOrThrow({ where: { id } });
}

async function notDecidable(id: string) {
  const current = await prisma.refundRequest.findUnique({ where: { id }, select: { status: true } });
  if (!current) return new RefundRequestError('Refund request not found', 404);
  return new RefundRequestError(`This refund request is already ${current.status.toLowerCase().replace('_', ' ')}`, 409);
}

async function syncDispute(
  request: Pick<RefundRequest, 'disputeId'>,
  data: { refundStatus: string; refundFailureReason?: string | null; refundAmount?: number | null }
) {
  if (!request.disputeId) return;
  await prisma.dispute.update({ where: { id: request.disputeId }, data });
}

async function notifyAdmins(title: string, message: string, bookingId: string) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
  await Promise.all(
    admins.map((admin) => notifyUser({ userId: admin.id, type: 'REFUND_REQUESTED', title, message, relatedId: bookingId }))
  );
}

async function notifyClient(
  request: Pick<RefundRequest, 'bookingId'>,
  type: 'REFUND_APPROVED' | 'REFUND_REJECTED',
  title: string,
  message: string
) {
  const booking = await prisma.booking.findUnique({ where: { id: request.bookingId }, select: { clientId: true } });
  if (booking) await notifyUser({ userId: booking.clientId, type, title, message, relatedId: request.bookingId });
}
