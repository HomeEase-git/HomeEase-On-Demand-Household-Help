import prisma from '@config/database';
import type { WalletTransactionType, Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

export class InsufficientBalanceError extends Error {
  constructor(message = 'Insufficient wallet balance') {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

async function ensureWallet(client: TxClient, workerProfileId: string) {
  return client.workerWallet.upsert({
    where: { workerProfileId },
    update: {},
    create: { workerProfileId },
  });
}

/**
 * Debits `amount` from the worker's wallet, atomically. Uses a conditional
 * `updateMany` (balance >= amount) rather than read-then-write so concurrent
 * debits can't race past a zero balance; throws InsufficientBalanceError if
 * the row didn't match (balance too low).
 *
 * `Tx` variants take an existing Prisma transaction client so they can be
 * composed into a caller's own `$transaction` (e.g. bookingController's
 * acceptBooking, which needs the debit and the capacity check to succeed or
 * fail together). The plain `debitWallet`/`creditWallet` wrappers below open
 * their own transaction for standalone callers (e.g. the top-up webhook).
 */
export async function debitWalletTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  type: WalletTransactionType,
  opts: { bookingId?: string; note?: string } = {}
) {
  const wallet = await ensureWallet(client, workerProfileId);

  const result = await client.workerWallet.updateMany({
    where: { id: wallet.id, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });

  if (result.count === 0) {
    throw new InsufficientBalanceError();
  }

  const updated = await client.workerWallet.findUniqueOrThrow({ where: { id: wallet.id } });

  const transaction = await client.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type,
      status: 'COMPLETED',
      amount: -Math.abs(amount),
      balanceAfter: updated.balance,
      bookingId: opts.bookingId,
      note: opts.note,
    },
  });

  return { wallet: updated, transaction };
}

export async function creditWalletTx(
  client: TxClient,
  workerProfileId: string,
  amount: number,
  type: WalletTransactionType,
  opts: { bookingId?: string; note?: string; xenditInvoiceId?: string } = {}
) {
  const wallet = await ensureWallet(client, workerProfileId);

  const updated = await client.workerWallet.update({
    where: { id: wallet.id },
    data: { balance: { increment: amount } },
  });

  const transaction = await client.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type,
      status: 'COMPLETED',
      amount: Math.abs(amount),
      balanceAfter: updated.balance,
      bookingId: opts.bookingId,
      note: opts.note,
      xenditInvoiceId: opts.xenditInvoiceId,
    },
  });

  return { wallet: updated, transaction };
}

export async function debitWallet(
  workerProfileId: string,
  amount: number,
  type: WalletTransactionType,
  opts?: { bookingId?: string; note?: string }
) {
  return prisma.$transaction((tx) => debitWalletTx(tx, workerProfileId, amount, type, opts));
}

export async function creditWallet(
  workerProfileId: string,
  amount: number,
  type: WalletTransactionType,
  opts?: { bookingId?: string; note?: string; xenditInvoiceId?: string }
) {
  return prisma.$transaction((tx) => creditWalletTx(tx, workerProfileId, amount, type, opts));
}

export async function getOrCreateWallet(workerProfileId: string) {
  return ensureWallet(prisma, workerProfileId);
}
