import prisma from '@config/database';
import { getAppSettings } from '@services/appSettingsService';
import { notifyUser } from '@utils/notify';
import { roundToCentavo } from '@utils/money';
import type { DebtLedgerEntryType, Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

/**
 * Row-locks the worker's dues for the rest of the transaction and returns the
 * current values. Every read-then-write of commissionOwed/compensationCredit
 * goes through this, so two money movements for the same worker (a payout
 * netting dues while a penalty or refund lands) can't overwrite each other.
 */
export async function lockDuesTx(client: TxClient, workerProfileId: string) {
  const rows = await client.$queryRaw<Array<{ commissionOwed: number; compensationCredit: number }>>`
    SELECT "commissionOwed", "compensationCredit" FROM "WorkerProfile" WHERE "id" = ${workerProfileId} FOR UPDATE`;
  if (rows.length === 0) throw new Error(`WorkerProfile ${workerProfileId} not found`);
  return rows[0];
}

/** Thrown when an admin tries to waive more than the worker actually owes. */
export class DuesAdjustmentError extends Error {}

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
  opts: { bookingId?: string; note?: string; type?: 'COMMISSION_DEBIT' | 'PENALTY' | 'RECOVERY_REVERSED' | 'ADMIN_ADJUSTMENT' } = {}
) {
  const abs = Math.abs(amount);
  const updated = await client.workerProfile.update({
    where: { id: workerProfileId },
    data: { commissionOwed: { increment: abs } },
  });

  const entry = await client.debtLedgerEntry.create({
    data: {
      workerProfileId,
      type: opts.type ?? 'COMMISSION_DEBIT',
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

      // Previously only the worker heard about this — a hold is a
      // dead end until an admin proactively goes looking for it
      // (releaseDebtHold requires an admin to act), so nothing ever
      // surfaced a newly-tripped hold to the people who can actually
      // clear it.
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

  return { workerProfile: updated, entry };
}

/**
 * Lowers what the worker owes by up to `amount`. What's beyond the current
 * balance is either added to compensationCredit (paid with their next online
 * payout — e.g. a refunded cash job whose dues were already recovered) or,
 * with `overflow: 'reject'`, refused. It used to be silently dropped.
 */
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

/**
 * Pays down commissionOwed out of an online job's payout, before the
 * remainder is disbursed. Deliberately does NOT clear debtHoldAt — a hold
 * requires an explicit admin action (releaseDebtHold), even if this recovery
 * brings the balance back to 0.
 */
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

/**
 * Undoes a refunded online payment's settlement: dues that were recovered
 * from its payout go back on the worker's tab (the client got that money
 * back, so the dues weren't really paid), and compensation credit that rode
 * along goes back to compensationCredit. Only call once the payout is known
 * to be stopped.
 */
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
    await lockDuesTx(client, workerProfileId);
    await client.workerProfile.update({
      where: { id: workerProfileId },
      data: { compensationCredit: { increment: opts.compensationPaid } },
    });
  }
}

/**
 * Reverses a previously-accrued COMMISSION_DEBIT because the underlying cash
 * payment was refunded/voided. If those dues were already paid down, the
 * excess becomes payout credit rather than vanishing.
 */
export async function reverseDebtTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  opts: { bookingId?: string; note?: string } = {}
) {
  return creditDebtTx(client, workerProfileId, amount, 'REVERSAL', { ...opts, overflow: 'credit' });
}

/**
 * Worker no-show / worker-fault cancellation penalty — added to what the
 * worker owes, recovered from their next payouts like cash-job dues (and it
 * can trip the same account hold).
 */
export async function chargePenaltyTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  opts: { bookingId?: string; note?: string } = {}
) {
  return accrueDebtTx(client, workerProfileId, amount, { ...opts, type: 'PENALTY' });
}

/**
 * Admin-approved client-fault cancellation compensation. Pays down what the
 * worker owes the platform first; anything left over is held as
 * WorkerProfile.compensationCredit and added to their next online payout
 * (see paymentLifecycleService.settleWorkerEarnings).
 */
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

/** Admin manual correction — always requires a reason, logged either direction. */
export async function adminAdjustDebt(
  workerProfileId: string,
  amount: number,
  note: string
) {
  return prisma.$transaction(async (tx) => {
    if (amount < 0) {
      // Negative = admin is increasing what's owed.
      return accrueDebtTx(tx, workerProfileId, -amount, { note, type: 'ADMIN_ADJUSTMENT' });
    }
    // A waiver can't go below zero — paying a worker extra is a separate
    // decision, not a dues correction.
    return creditDebtTx(tx, workerProfileId, amount, 'ADMIN_ADJUSTMENT', { note, overflow: 'reject' });
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
