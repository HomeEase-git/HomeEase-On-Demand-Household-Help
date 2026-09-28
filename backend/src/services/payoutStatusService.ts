import prisma from '@config/database';
import type { Payout, PayoutStatus } from '@prisma/client';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { writeAuditLog } from '@utils/auditLog';

// Xendit's payout states. SUCCEEDED is the documented terminal success;
// COMPLETED is kept because the original integration assumed it — prune once
// real sandbox payloads are observed.
const SUCCESS_STATUSES = new Set(['SUCCEEDED', 'COMPLETED']);
const FAILURE_STATUSES = new Set(['FAILED', 'REVERSED']);

export type PayoutTransition = 'paid' | 'failed' | 'cancelled' | 'paid-after-cancel' | 'unchanged';

/**
 * Applies a status Xendit reported for a payout (webhook, reconciliation
 * sweep, or the synchronous create response). Every write is guarded on the
 * payout's current status, so a duplicate webhook can't re-notify the worker
 * and a payout cancelled because its payment was refunded is never flipped
 * back to PAID. If Xendit says a cancelled payout went through anyway, the
 * money left twice — that is logged as an error for a manual clawback instead
 * of being silently recorded.
 */
export async function applyXenditPayoutStatus(
  payout: Pick<Payout, 'id' | 'workerId' | 'bookingId' | 'amount' | 'channel' | 'xenditDisbursementId'>,
  rawStatus: string | undefined,
  details: {
    xenditDisbursementId?: string | null;
    failureReason?: string | null;
    // Worker-facing explanation appended to the failure notice.
    failureNotice?: string;
  } = {}
): Promise<PayoutTransition> {
  const status = rawStatus?.toUpperCase();
  if (!status) return 'unchanged';

  const xenditDisbursementId = details.xenditDisbursementId ?? payout.xenditDisbursementId;

  if (SUCCESS_STATUSES.has(status)) {
    // FAILED is included: a send that timed out on our side may still have
    // gone through at Xendit, and the money really did reach the worker.
    const updated = await transition(payout.id, ['PENDING', 'PROCESSING', 'FAILED'], {
      status: 'PAID',
      xenditStatus: rawStatus,
      xenditDisbursementId,
      paidAt: new Date(),
    });
    if (updated) {
      await notifyUser({
        userId: payout.workerId,
        type: 'PAYOUT_SENT',
        title: 'Payout Sent',
        message: `₱${payout.amount.toFixed(2)} has been sent to your ${payout.channel} account`,
        relatedId: payout.bookingId,
      });
      void sendSmsToUser({
        userId: payout.workerId,
        message: `HomeEase: ₱${payout.amount.toFixed(2)} has been sent to your ${payout.channel} account.`,
      });
      return 'paid';
    }

    const current = await prisma.payout.findUnique({ where: { id: payout.id }, select: { status: true } });
    if (current?.status === 'CANCELLED') {
      await prisma.payout.update({ where: { id: payout.id }, data: { xenditStatus: rawStatus } });
      await writeAuditLog({
        action: 'PAYOUT_PAID_AFTER_CANCEL',
        category: 'SYSTEM_ERROR',
        level: 'ERROR',
        message:
          `Xendit reports payout ${payout.id} (₱${payout.amount.toFixed(2)}) for booking ${payout.bookingId} ` +
          `as ${status}, but it was cancelled because the payment was refunded — recover it from the worker manually.`,
        metadata: { payoutId: payout.id, bookingId: payout.bookingId, workerId: payout.workerId, xenditStatus: status },
      });
      return 'paid-after-cancel';
    }
    return 'unchanged';
  }

  if (FAILURE_STATUSES.has(status)) {
    const updated = await transition(payout.id, ['PENDING', 'PROCESSING'], {
      status: 'FAILED',
      xenditStatus: rawStatus,
      xenditDisbursementId,
      failureReason: details.failureReason ?? `Xendit reported ${status}`,
      failedAt: new Date(),
    });
    if (!updated) return 'unchanged';
    const notice = `We couldn't send your ₱${payout.amount.toFixed(2)} payout. ${details.failureNotice ?? 'Our team has been notified.'}`;
    await notifyUser({
      userId: payout.workerId,
      type: 'PAYOUT_FAILED',
      title: 'Payout Failed',
      message: notice,
      relatedId: payout.bookingId,
    });
    void sendSmsToUser({ userId: payout.workerId, message: `HomeEase: ${notice}` });
    return 'failed';
  }

  if (status === 'CANCELLED') {
    const updated = await transition(payout.id, ['PENDING', 'PROCESSING', 'FAILED'], {
      status: 'CANCELLED',
      xenditStatus: rawStatus,
      xenditDisbursementId,
      failedAt: new Date(),
    });
    return updated ? 'cancelled' : 'unchanged';
  }

  // ACCEPTED / REQUESTED / anything else: still in flight.
  if (xenditDisbursementId !== payout.xenditDisbursementId) {
    await prisma.payout.update({ where: { id: payout.id }, data: { xenditDisbursementId, xenditStatus: rawStatus } });
  }
  return 'unchanged';
}

async function transition(
  payoutId: string,
  from: PayoutStatus[],
  data: Parameters<typeof prisma.payout.updateMany>[0]['data']
): Promise<boolean> {
  const res = await prisma.payout.updateMany({ where: { id: payoutId, status: { in: from } }, data });
  return res.count === 1;
}
