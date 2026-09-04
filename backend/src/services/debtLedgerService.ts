import prisma from '@config/database';
import { getAppSettings } from '@services/appSettingsService';
import { notifyUser } from '@utils/notify';
import type { DebtLedgerEntryType, Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

/**
 * Accrues `amount` of platform commission + withholding tax onto a worker's
 * running tab — the ONLY path that increases `commissionOwed`. Used when the
 * platform's cut can't be collected through a gateway because the client
 * paid the worker in person (CASH jobs). If this pushes the worker's owed
 * total past AppSettings.workerDebtHoldLimit, the account is placed on hold
 * (blocks new job acceptance/matching — see bookingController, matchingService)
 * until an admin explicitly releases it via releaseDebtHold.
 */
export async function accrueDebtTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  opts: { bookingId?: string; note?: string } = {}
) {
  const abs = Math.abs(amount);
  const updated = await client.workerProfile.update({
    where: { id: workerProfileId },
    data: { commissionOwed: { increment: abs } },
  });

  const entry = await client.debtLedgerEntry.create({
    data: {
      workerProfileId,
      type: 'COMMISSION_DEBIT',
      amount: abs,
      balanceAfter: updated.commissionOwed,
      bookingId: opts.bookingId,
      note: opts.note,
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
    }
  }

  return { workerProfile: updated, entry };
}

async function creditDebtTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  type: DebtLedgerEntryType,
  opts: { bookingId?: string; note?: string } = {}
) {
  const abs = Math.abs(amount);
  const current = await client.workerProfile.findUniqueOrThrow({
    where: { id: workerProfileId },
    select: { commissionOwed: true },
  });
  const newOwed = Math.max(0, Math.round((current.commissionOwed - abs) * 100) / 100);

  const updated = await client.workerProfile.update({
    where: { id: workerProfileId },
    data: { commissionOwed: newOwed },
  });

  const entry = await client.debtLedgerEntry.create({
    data: {
      workerProfileId,
      type,
      amount: -abs,
      balanceAfter: updated.commissionOwed,
      bookingId: opts.bookingId,
      note: opts.note,
    },
  });

  return { workerProfile: updated, entry };
}

/**
 * Pays down commissionOwed out of an online job's payout, before the
 * remainder is disbursed. Deliberately does NOT clear debtHoldAt — a hold
 * requires an explicit admin action (releaseDebtHold), even if this recovery
 * brings the balance back to 0.
 */
export async function recoverDebtTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  opts: { bookingId?: string; note?: string } = {}
) {
  return creditDebtTx(client, workerProfileId, amount, 'DEBT_RECOVERY', opts);
}

/**
 * Reverses a previously-accrued COMMISSION_DEBIT because the underlying cash
 * payment was refunded/voided. Same non-negative floor and hold behavior as
 * recoverDebtTx.
 */
export async function reverseDebtTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  opts: { bookingId?: string; note?: string } = {}
) {
  return creditDebtTx(client, workerProfileId, amount, 'REVERSAL', opts);
}

/** Admin manual correction — always requires a reason, logged either direction. */
export async function adminAdjustDebt(
  workerProfileId: string,
  amount: number,
  note: string
) {
  return prisma.$transaction(async (tx) => {
    if (amount < 0) {
      // Negative = admin is increasing what's owed.
      return accrueDebtTx(tx, workerProfileId, -amount, { note });
    }
    return creditDebtTx(tx, workerProfileId, amount, 'ADMIN_ADJUSTMENT', { note });
  });
}

/** Clears an account hold. Requires an admin to have actually looked at it. */
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
