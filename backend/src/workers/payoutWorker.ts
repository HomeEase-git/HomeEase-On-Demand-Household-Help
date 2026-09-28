import { Worker, type Job } from 'bullmq';
import prisma from '@config/database';
import { decryptField } from '@utils/fieldEncryption';
import { workerConnection as connection } from '@config/redis';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { writeAuditLog } from '@utils/auditLog';
import { PAYOUT_QUEUE_NAME, PAYOUT_JOB_NAMES, type SendPayoutJobData } from '@queues/payoutQueue';
import { createPayout, xenditChannelCodeFor } from '@services/xenditDisbursementService';
import { applyXenditPayoutStatus } from '@services/payoutStatusService';

export async function processSendPayout(job: Job, data: SendPayoutJobData): Promise<void> {
  const payout = await prisma.payout.findUnique({ where: { id: data.payoutId } });
  if (!payout) return; // deleted/invalid — nothing to do

  // Only a PENDING payout is sendable. PAID/PROCESSING are already handled,
  // FAILED waits for an admin retry, and CANCELLED means the payment was
  // refunded — sending it would pay the worker for money the client got back.
  if (payout.status !== 'PENDING') return;

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

  // Atomic claim: a refund cancelling this payout (or a duplicate job) racing
  // us between the read above and here wins, and nothing is sent.
  const claim = await prisma.payout.updateMany({
    where: { id: payout.id, status: 'PENDING' },
    data: { status: 'PROCESSING', processingAt: new Date(), attempts: { increment: 1 } },
  });
  if (claim.count === 0) return;

  try {
    const xenditPayout = await createPayout({
      referenceId: payout.id,
      amountPesos: payout.amount,
      channelCode,
      accountNumber: decryptField(payout.accountNumber),
      accountHolderName: payout.accountName || 'HomeEase Worker',
      description: `HomeEase payout for booking ${payout.bookingId}`,
    });

    // ACCEPTED is the usual synchronous answer and leaves the payout
    // PROCESSING; the payout webhook (or the reconciliation sweep) reports
    // the final state later. Record the Xendit id either way so a refund can
    // cancel it while it's still in flight.
    await prisma.payout.update({
      where: { id: payout.id },
      data: { xenditDisbursementId: xenditPayout.id, xenditStatus: xenditPayout.status },
    });
    await applyXenditPayoutStatus({ ...payout, xenditDisbursementId: xenditPayout.id }, xenditPayout.status, {
      failureReason: 'Xendit reported immediate failure',
    });
  } catch (error) {
    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const message = error instanceof Error ? error.message : 'Unknown disbursement error';

    await prisma.payout.updateMany({
      where: { id: payout.id, status: 'PROCESSING' },
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

  // Mandatory per BullMQ's own docs — see the identical note in
  // bookingQueue.ts.
  worker.on('error', (err) => {
    console.error('payoutWorker Redis connection error:', err.message);
  });

  return worker;
}
