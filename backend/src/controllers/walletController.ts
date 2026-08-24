import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { notifyUser } from '@utils/notify';
import { getOrCreateWallet } from '@services/walletService';
import { createInvoice } from '@services/xenditService';
import { translateXenditFailureReason } from '@utils/xenditFailureMessages';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const MIN_TOPUP_AMOUNT = 50;
const MAX_TOPUP_AMOUNT = 10000;

/**
 * GET /api/workers/me/wallet
 * Balance + recent transaction history for the logged-in worker.
 */
export const getMyWallet = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers have a wallet'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const wallet = await getOrCreateWallet(workerProfile.id);
    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    return res.status(200).json({
      success: true,
      data: {
        balance: wallet.balance,
        transactions: transactions.map((t) => ({
          id: t.id,
          type: t.type,
          status: t.status,
          amount: t.amount,
          balanceAfter: t.balanceAfter,
          bookingId: t.bookingId,
          note: t.note,
          failureMessage: t.status === 'FAILED' ? translateXenditFailureReason(t.failureReason) : null,
          createdAt: t.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching wallet:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch wallet'));
  }
};

/**
 * POST /api/workers/me/wallet/topup
 * Starts a Xendit Invoice checkout to top up the worker's wallet. Mirrors
 * paymentController.createXenditCheckout — a PENDING WalletTransaction is
 * created up front, keyed by the Xendit invoice id, so the shared webhook
 * handler (see handleWalletTopupPaid below) can find it once Xendit reports
 * the invoice as paid.
 */
export const topupWallet = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'WORKER') {
      return res.status(403).json(errorResponse(403, 'Only workers can top up a wallet'));
    }

    const { amount, methodType } = req.body as { amount?: number; methodType?: 'GCASH' | 'MAYA' };

    if (typeof amount !== 'number' || amount < MIN_TOPUP_AMOUNT || amount > MAX_TOPUP_AMOUNT) {
      return res
        .status(400)
        .json(errorResponse(400, `amount must be a number between ${MIN_TOPUP_AMOUNT} and ${MAX_TOPUP_AMOUNT}`));
    }
    if (methodType !== 'GCASH' && methodType !== 'MAYA') {
      return res.status(400).json(errorResponse(400, 'methodType must be GCASH or MAYA'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: req.user.userId } });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker profile not found'));
    }

    const wallet = await getOrCreateWallet(workerProfile.id);

    const redirectBase = process.env.XENDIT_REDIRECT_BASE_URL || 'https://homeease.app';
    const invoice = await createInvoice({
      // Just a Xendit-side dedup/display hint — our webhook looks up the
      // WalletTransaction by xenditInvoiceId, not this external_id.
      externalId: `wallet-topup-${workerProfile.id}-${Date.now()}`,
      amountPesos: amount,
      description: `HomeEase wallet top-up (${workerProfile.id})`,
      // Reuses the same redirect prefixes as booking checkout — the mobile
      // WebView (XenditCheckoutModal) intercepts by prefix only, it has no
      // booking-specific logic, so both flows share it.
      successRedirectUrl: `${redirectBase}/payment-redirect/success`,
      failureRedirectUrl: `${redirectBase}/payment-redirect/failed`,
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'TOPUP',
        status: 'PENDING',
        amount,
        xenditInvoiceId: invoice.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Xendit checkout created',
      data: { checkoutUrl: invoice.invoiceUrl, invoiceId: invoice.id },
    });
  } catch (error) {
    console.error('Error creating wallet top-up checkout:', error);
    return res.status(500).json(errorResponse(500, 'Failed to start top-up'));
  }
};

/**
 * Called from paymentController.handleXenditInvoiceWebhook's `PAID` case,
 * after handleInvoicePaid finds no matching booking Payment for this invoice
 * id — the same Xendit invoice-paid event covers both booking checkouts and
 * wallet top-ups, distinguished only by which table has a row for that
 * invoice id. Capture is atomic on Xendit's side, so unlike the old PayMongo
 * flow there's no separate "charge the source" call here — the wallet is
 * credited directly once the webhook confirms payment.
 */
export async function handleWalletTopupPaid(invoice: any) {
  const invoiceId = invoice?.id as string | undefined;
  if (!invoiceId) return;

  const walletTx = await prisma.walletTransaction.findFirst({
    where: { xenditInvoiceId: invoiceId, status: 'PENDING', type: 'TOPUP' },
    include: { wallet: { include: { workerProfile: { select: { userId: true } } } } },
  });
  if (!walletTx) return;

  await prisma.$transaction(async (tx) => {
    const updatedWallet = await tx.workerWallet.update({
      where: { id: walletTx.walletId },
      data: { balance: { increment: walletTx.amount } },
    });
    await tx.walletTransaction.update({
      where: { id: walletTx.id },
      data: { status: 'COMPLETED', balanceAfter: updatedWallet.balance },
    });
  });

  await notifyUser({
    userId: walletTx.wallet.workerProfile.userId,
    type: 'PAYOUT_SENT',
    title: 'Wallet Topped Up',
    message: `₱${walletTx.amount.toFixed(2)} was added to your wallet.`,
    relatedId: walletTx.id,
  });
}

/**
 * Called from paymentController.handleXenditInvoiceWebhook's
 * EXPIRED/FAILED case, alongside handleInvoiceFailed — same dual-path
 * reasoning as above.
 */
export async function handleWalletTopupFailed(invoiceId: string | undefined, failureReason?: string | null) {
  if (!invoiceId) return;

  await prisma.walletTransaction.updateMany({
    where: { xenditInvoiceId: invoiceId, status: 'PENDING', type: 'TOPUP' },
    data: { status: 'FAILED', failureReason: failureReason ?? 'Xendit reported failure' },
  });
}

/**
 * GET /api/admin/users/workers/:id/wallet
 */
export const getWorkerWalletAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: id } });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const wallet = await getOrCreateWallet(workerProfile.id);
    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.json({
      success: true,
      data: {
        balance: wallet.balance,
        transactions: transactions.map((t) => ({
          id: t.id,
          type: t.type,
          status: t.status,
          amount: t.amount,
          balanceAfter: t.balanceAfter,
          bookingId: t.bookingId,
          note: t.note,
          failureReason: t.failureReason,
          createdAt: t.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching worker wallet:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch wallet'));
  }
};

/**
 * PATCH /api/admin/users/workers/:id/wallet/adjust
 * Manual credit/debit with a required reason — for support cases (goodwill
 * credit, correcting a bad deduction). `amount` is signed: positive credits,
 * negative debits.
 */
export const adjustWorkerWalletAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { amount, reason } = req.body as { amount?: number; reason?: string };

    if (typeof amount !== 'number' || amount === 0) {
      return res.status(400).json(errorResponse(400, 'amount must be a non-zero number'));
    }
    if (!reason?.trim()) {
      return res.status(400).json(errorResponse(400, 'reason is required'));
    }

    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId: id } });
    if (!workerProfile) {
      return res.status(404).json(errorResponse(404, 'Worker not found'));
    }

    const wallet = await prisma.$transaction(async (tx) => {
      const w = await tx.workerWallet.upsert({
        where: { workerProfileId: workerProfile.id },
        update: {},
        create: { workerProfileId: workerProfile.id },
      });
      const updated = await tx.workerWallet.update({
        where: { id: w.id },
        data: { balance: { increment: amount } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: w.id,
          type: 'ADMIN_ADJUSTMENT',
          status: 'COMPLETED',
          amount,
          balanceAfter: updated.balance,
          note: reason.trim(),
        },
      });
      return updated;
    });

    return res.json({ success: true, data: { balance: wallet.balance } });
  } catch (error) {
    console.error('Error adjusting worker wallet:', error);
    return res.status(500).json(errorResponse(500, 'Failed to adjust wallet'));
  }
};
