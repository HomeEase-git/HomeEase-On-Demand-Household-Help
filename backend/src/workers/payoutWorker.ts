import { Worker, type Job } from 'bullmq';
import prisma from '@config/database';
import { redisConnection as connection } from '@config/redis';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { writeAuditLog } from '@utils/auditLog';
import { PAYOUT_QUEUE_NAME, PAYOUT_JOB_NAMES, type SendPayoutJobData } from '@queues/payoutQueue';
import { createPayout, xenditChannelCodeFor } from '@services/xenditDisbursementService';

// Xendit's synchronous payout response is ACCEPTED — this is NOT terminal
// (unlike PayMongo's 'succeeded', which was). A hand-validated manual test
// showed a payout can sit at ACCEPTED well past its estimated_arrival_time;
// the actual terminal state (COMPLETED or FAILED) arrives later via the
// payout webhook (see paymentController.handleXenditPayoutWebhook).
// SUCCEEDED is included defensively in case Xendit uses it interchangeably
// with COMPLETED — UNCONFIRMED, prune once real payloads are observed.
const TERMINAL_SUCCESS_STATUSES = new Set(['COMPLETED', 'SUCCEEDED']);

export async function processSendPayout(job: Job, data: SendPayoutJobData): Promise<void> {
  const payout = await prisma.payout.findUnique({ where: { id: data.payoutId } });
  if (!payout) return; // deleted/invalid — nothing to do

  // Already terminal — a retried/duplicate job shouldn't resend.
  if (payout.status === 'PAID' || payout.status === 'PROCESSING') return;

  const channelCode = xenditChannelCodeFor(payout.channel);
  if (!channelCode) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: 'FAILED',
        failureReason: `Unsupported payout channel: ${payout.channel}`,
        failedAt: new Date(),
      },
    });
    return; // not retryable — don't throw, this will never succeed
  }

  await prisma.payout.update({
    where: { id: payout.id },
    data: { status: 'PROCESSING', processingAt: new Date(), attempts: { increment: 1 } },
  });

  try {
    const xenditPayout = await createPayout({
      referenceId: payout.id,
      amountPesos: payout.amount,
      channelCode,
      accountNumber: payout.accountNumber,
      accountHolderName: payout.accountName || 'HomeEase Worker',
      description: `HomeEase payout for booking ${payout.bookingId}`,
    });

    const normalizedStatus = xenditPayout.status.toUpperCase();
    const isImmediatelyPaid = TERMINAL_SUCCESS_STATUSES.has(normalizedStatus);
    const isImmediatelyFailed = normalizedStatus === 'FAILED';

    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        xenditDisbursementId: xenditPayout.id,
        xenditStatus: xenditPayout.status,
        ...(isImmediatelyPaid ? { status: 'PAID', paidAt: new Date() } : {}),
        ...(isImmediatelyFailed
          ? { status: 'FAILED', failureReason: 'Xendit reported immediate failure', failedAt: new Date() }
          : {}),
      },
    });

    if (isImmediatelyPaid) {
      await notifyUser({
        userId: payout.workerId,
        type: 'PAYOUT_SENT',
        title: 'Payout Sent',
        message: `₱${payout.amount.toFixed(2)} has been sent to your ${payout.channel} account`,
        relatedId: payout.bookingId,
      });
      // Money moving is the clearest case for SMS — same expectation as a
      // bank alert. Fire-and-forget, never blocks the worker job.
      void sendSmsToUser({
        userId: payout.workerId,
        message: `HomeEase: ₱${payout.amount.toFixed(2)} has been sent to your ${payout.channel} account.`,
      });
    } else if (isImmediatelyFailed) {
      await notifyUser({
        userId: payout.workerId,
        type: 'PAYOUT_FAILED',
        title: 'Payout Failed',
        message: `We couldn't send your ₱${payout.amount.toFixed(2)} payout. Our team has been notified.`,
        relatedId: payout.bookingId,
      });
      void sendSmsToUser({
        userId: payout.workerId,
        message: `HomeEase: We couldn't send your ₱${payout.amount.toFixed(2)} payout. Our team has been notified.`,
      });
    }
    // Otherwise (ACCEPTED/PENDING) the payout stays PROCESSING — the payout
    // webhook (handleXenditPayoutWebhook) will flip it to PAID/FAILED later.
  } catch (error) {
    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const message = error instanceof Error ? error.message : 'Unknown disbursement error';

    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: isFinalAttempt ? 'FAILED' : 'PENDING',
        failureReason: message,
        ...(isFinalAttempt ? { failedAt: new Date() } : {}),
      },
    });

    if (isFinalAttempt) {
      await notifyUser({
        userId: payout.workerId,
        type: 'PAYOUT_FAILED',
        title: 'Payout Failed',
        message: `We couldn't send your ₱${payout.amount.toFixed(2)} payout. Our team has been notified.`,
        relatedId: payout.bookingId,
      });
      void sendSmsToUser({
        userId: payout.workerId,
        message: `HomeEase: We couldn't send your ₱${payout.amount.toFixed(2)} payout. Our team has been notified.`,
      });
      await writeAuditLog({
        action: 'PAYOUT_FAILED',
        category: 'SYSTEM_ERROR',
        level: 'ERROR',
        message: `Payout ${payout.id} for booking ${payout.bookingId} failed after ${job.attemptsMade + 1} attempts: ${message}`,
        metadata: { payoutId: payout.id, bookingId: payout.bookingId, workerId: payout.workerId },
      });
    }

    throw error; // let BullMQ apply backoff/retry
  }
}

export async function startPayoutWorker() {
  const worker = new Worker(
    PAYOUT_QUEUE_NAME,
    async (job: Job) => {
      switch (job.name) {
        case PAYOUT_JOB_NAMES.SEND_PAYOUT:
          await processSendPayout(job, job.data as SendPayoutJobData);
          break;
        default:
          console.warn(`Unknown payout queue job: ${job.name}`);
      }
      return { success: true };
    },
    { connection }
  );

  worker.on('failed', (job, err) => {
    console.error(`Payout queue job ${job?.name}#${job?.id} failed`, err);
  });

  return worker;
}
