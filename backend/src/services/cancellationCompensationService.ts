import type { Prisma } from '@prisma/client';
import { postCancellationFee } from '@services/ledgerService';
import { creditCompensationTx } from '@services/debtLedgerService';
import { formatDisplayId } from '@utils/formatters';

/**
 * A confirmed client-fault cancellation: the client owes the fee (account on
 * hold until it's settled) and the worker is compensated (against their dues
 * first, the rest on their next payout). Status-guarded so two reviewers
 * can't both decide it — returns false if the claim was already reviewed.
 */
export async function applyClientFaultCompensationTx(
  tx: Prisma.TransactionClient,
  input: {
    bookingId: string;
    clientId: string;
    workerId: string;
    amount: number;
    reviewedById: string | null;
    reviewNote: string;
  }
): Promise<boolean> {
  const { bookingId, clientId, workerId, amount } = input;
  const displayId = formatDisplayId(bookingId);

  const claim = await tx.cancellation.updateMany({
    where: { bookingId, compensationStatus: 'PENDING_REVIEW' },
    data: {
      compensationStatus: 'APPROVED',
      reviewedById: input.reviewedById,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote,
    },
  });
  if (claim.count === 0) return false;

  const workerProfile = await tx.workerProfile.findUniqueOrThrow({ where: { userId: workerId }, select: { id: true } });

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
  return true;
}
