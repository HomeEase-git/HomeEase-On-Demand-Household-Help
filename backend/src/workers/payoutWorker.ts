import { Worker, type Job } from 'bullmq';
import prisma from '@config/database';
import { redisConnection as connection } from '@config/redis';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';
import { PAYOUT_QUEUE_NAME, PAYOUT_JOB_NAMES, type SendPayoutJobData } from '@queues/payoutQueue';
import { createTransfer, paymongoDestinationBicFor } from '@services/paymongoDisbursementService';

const TERMINAL_SUCCESS_STATUSES = new Set(['succeeded']);

export async function processSendPayout(job: Job, data: SendPayoutJobData): Promise<void> {
  const payout = await prisma.payout.findUnique({ where: { id: data.payoutId } });
  if (!payout) return; // deleted/invalid — nothing to do

  // Already terminal — a retried/duplicate job shouldn't resend.
  if (payout.status === 'PAID' || payout.status === 'PROCESSING') return;

  const destinationBic = await paymongoDestinationBicFor(payout.channel, payout.amount);
  if (!destinationBic) {
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
    const transfer = await createTransfer({
      referenceNumber: payout.id,
      amountPesos: payout.amount,
      destinationBic,
      accountNumber: payout.accountNumber,
      accountHolderName: payout.accountName || 'HomeEase Worker',
      description: `HomeEase payout for booking ${payout.bookingId}`,
      callbackUrl: `${process.env.APP_URL}/api/payments/paymongo/transfers/callback`,
    });

    const isImmediatelyPaid = TERMINAL_SUCCESS_STATUSES.has(transfer.status.toLowerCase());

    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        paymongoTransferId: transfer.id,
        paymongoTransferStatus: transfer.status,
        ...(isImmediatelyPaid ? { status: 'PAID', paidAt: new Date() } : {}),
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
    }
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
