import prisma from '@config/database';
import { getAppSettings } from '@services/appSettingsService';
import { notifyUser } from '@utils/notify';
import { roundToCentavo } from '@utils/money';
import type { DebtLedgerEntryType, Prisma } from '@prisma/client';
import { postPenalty, postAdminAdjustment, postDebtPayment } from '@services/ledgerService';

type TxClient = Prisma.TransactionClient;

export async function lockDuesTx(client: TxClient, workerProfileId: string) {
  const rows = await client.$queryRaw<Array<{ commissionOwed: number; compensationCredit: number }>>`
    SELECT "commissionOwed", "compensationCredit" FROM "WorkerProfile" WHERE "id" = ${workerProfileId} FOR UPDATE`;
  if (rows.length === 0) throw new Error(`WorkerProfile ${workerProfileId} not found`);
  return rows[0];
}

export class DuesAdjustmentError extends Error {}

export async function accrueDebtTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  opts: { bookingId?: string; note?: string; type?: 'COMMISSION_DEBIT' | 'PENALTY' | 'RECOVERY_REVERSED' | 'ADMIN_ADJUSTMENT' } = {}
) {
  const abs = roundToCentavo(Math.abs(amount));
  const current = await lockDuesTx(client, workerProfileId);
  const covered = roundToCentavo(Math.min(Math.max(0, current.compensationCredit), abs));
  const added = roundToCentavo(abs - covered);

  const updated = await client.workerProfile.update({
    where: { id: workerProfileId },
    data: {
      commissionOwed: roundToCentavo(current.commissionOwed + added),
      ...(covered > 0 ? { compensationCredit: roundToCentavo(current.compensationCredit - covered) } : {}),
    },
  });

  const coveredNote = covered > 0 ? `₱${covered.toFixed(2)} covered by payout credit` : null;
  const entry = await client.debtLedgerEntry.create({
    data: {
      workerProfileId,
      type: opts.type ?? 'COMMISSION_DEBIT',
      amount: added,
      balanceAfter: updated.commissionOwed,
      bookingId: opts.bookingId,
      note: [opts.note, coveredNote].filter(Boolean).join(' — ') || null,
    },
  });

  if (!updated.debtHoldAt) {
    const { workerDebtHoldLimit } = await getAppSettings();
    if (workerDebtHoldLimit > 0 && updated.commissionOwed >= workerDebtHoldLimit) {
      await client.workerProfile.update({
        where: { id: workerProfileId },
        data: { debtHoldAt: new Date() },
      });
      await notifyUser({
        userId: updated.userId,
        type: 'ACCOUNT_ON_HOLD',
        title: 'Account on hold',
        message:
          `Your outstanding platform dues (₱${updated.commissionOwed.toFixed(2)}) have reached the ` +
          `limit. You can't accept new jobs until you contact support to resolve this.`,
      });

      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
      await Promise.all(
        admins.map((admin) =>
          notifyUser({
            userId: admin.id,
            type: 'ACCOUNT_ON_HOLD',
            title: 'Worker account placed on hold',
            message: `Worker ${updated.userId} was placed on hold — outstanding dues of ₱${updated.commissionOwed.toFixed(2)} reached the limit (₱${workerDebtHoldLimit.toFixed(2)}).`,
            relatedId: updated.userId,
          })
        )
      );
    }
  }

  return { workerProfile: updated, entry, coveredByCredit: covered };
}

async function creditDebtTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  type: DebtLedgerEntryType,
  opts: { bookingId?: string; note?: string; overflow?: 'credit' | 'reject' } = {}
) {
  const abs = roundToCentavo(Math.abs(amount));
  const current = await lockDuesTx(client, workerProfileId);
  const applied = roundToCentavo(Math.min(Math.max(0, current.commissionOwed), abs));
  const excess = roundToCentavo(abs - applied);

  if (excess > 0 && opts.overflow === 'reject') {
    throw new DuesAdjustmentError(
      `The worker only owes ₱${Math.max(0, current.commissionOwed).toFixed(2)} — can't reduce it by ₱${abs.toFixed(2)}`
    );
  }

  const updated = await client.workerProfile.update({
    where: { id: workerProfileId },
    data: {
      commissionOwed: roundToCentavo(current.commissionOwed - applied),
      ...(excess > 0 ? { compensationCredit: roundToCentavo(current.compensationCredit + excess) } : {}),
    },
  });

  const excessNote = excess > 0 ? `₱${excess.toFixed(2)} beyond what was owed added to payout credit` : null;
  const entry = await client.debtLedgerEntry.create({
    data: {
      workerProfileId,
      type,
      amount: -applied,
      balanceAfter: updated.commissionOwed,
      bookingId: opts.bookingId,
      note: [opts.note, excessNote].filter(Boolean).join(' — ') || null,
    },
  });

  return { workerProfile: updated, entry, applied, credited: excess };
}

export async function recoverDebtTx(
  client: TxClient,
  workerProfileId: string,
  maxAmount: number,
  opts: { bookingId?: string; note?: string } = {}
): Promise<number> {
  const { commissionOwed } = await lockDuesTx(client, workerProfileId);
  const take = roundToCentavo(Math.min(Math.max(0, commissionOwed), Math.max(0, maxAmount)));
  if (take <= 0) return 0;
  await creditDebtTx(client, workerProfileId, take, 'DEBT_RECOVERY', opts);
  return take;
}

export async function restoreSettlementTx(
  client: TxClient,
  workerProfileId: string,
  opts: { bookingId: string; duesRecovered: number; compensationPaid: number }
) {
  if (opts.duesRecovered > 0) {
    await accrueDebtTx(client, workerProfileId, opts.duesRecovered, {
      bookingId: opts.bookingId,
      type: 'RECOVERY_REVERSED',
      note: 'Dues recovered from this job\'s payout put back — the job was refunded',
    });
  }
  if (opts.compensationPaid > 0) {
    await creditDebtTx(client, workerProfileId, opts.compensationPaid, 'COMPENSATION', {
      bookingId: opts.bookingId,
      note: 'Compensation that was in this job\'s payout put back — the job was refunded',
      overflow: 'credit',
    });
  }
}

export async function reverseDebtTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  opts: { bookingId?: string; note?: string } = {}
) {
  return creditDebtTx(client, workerProfileId, amount, 'REVERSAL', { ...opts, overflow: 'credit' });
}

export async function chargePenaltyTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  opts: { bookingId?: string; note?: string } = {}
) {
  const result = await accrueDebtTx(client, workerProfileId, amount, { ...opts, type: 'PENALTY' });
  await postPenalty(client, result.workerProfile.userId, amount, { key: result.entry.id, bookingId: opts.bookingId });
  return result;
}

export async function creditCompensationTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  opts: { bookingId?: string; note?: string } = {}
) {
  const { applied, credited } = await creditDebtTx(client, workerProfileId, amount, 'COMPENSATION', {
    ...opts,
    overflow: 'credit',
  });
  return { againstDebt: applied, credited };
}

export async function applyDebtPaymentTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  debtPaymentId: string,
  paidAt?: Date
) {
  const result = await creditDebtTx(client, workerProfileId, amount, 'DEBT_PAYMENT', {
    note: 'Paid online',
    overflow: 'credit',
  });
  await postDebtPayment(client, result.workerProfile.userId, amount, debtPaymentId, paidAt);

  let holdReleased = false;
  if (result.workerProfile.commissionOwed <= 0 && result.workerProfile.debtHoldAt) {
    await client.workerProfile.update({
      where: { id: workerProfileId },
      data: { debtHoldAt: null, debtHoldNote: 'Cleared automatically — dues paid in full' },
    });
    holdReleased = true;
  }
  return { ...result, holdReleased };
}

export async function adminAdjustDebt(
  workerProfileId: string,
  amount: number,
  note: string
) {
  return prisma.$transaction(async (tx) => {
    if (amount < 0) {
      // Negative = admin is increasing what's owed.
      const result = await accrueDebtTx(tx, workerProfileId, -amount, { note, type: 'ADMIN_ADJUSTMENT' });
      await postAdminAdjustment(tx, result.workerProfile.userId, -amount, result.entry.id, note);
      return result;
    }
    const result = await creditDebtTx(tx, workerProfileId, amount, 'ADMIN_ADJUSTMENT', { note, overflow: 'reject' });
    await postAdminAdjustment(tx, result.workerProfile.userId, -amount, result.entry.id, note);
    return result;
  });
}

export async function releaseDebtHold(workerProfileId: string, note?: string) {
  const updated = await prisma.workerProfile.update({
    where: { id: workerProfileId },
    data: { debtHoldAt: null, debtHoldNote: note ?? null },
  });

  await notifyUser({
    userId: updated.userId,
    type: 'ACCOUNT_HOLD_RELEASED',
    title: 'Account hold lifted',
    message: 'Your account is back in good standing — you can accept new jobs again.',
  });

  return updated;
}
