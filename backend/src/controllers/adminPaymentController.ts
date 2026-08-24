import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatDisplayId, formatPeso } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { writeAuditLog } from '@utils/auditLog';
import { schedulePayout } from '@queues/payoutQueue';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const paymentInclude = {
  booking: {
    include: {
      worker: { select: { id: true, fullName: true } },
      client: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

type PaymentRecord = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

function formatPayment(record: PaymentRecord) {
  const totalAmount = record.totalAmount ?? 0;
  const commissionAmount = record.commissionAmount ?? 0;
  const workerAmount = Math.max(totalAmount - commissionAmount, 0);

  return {
    id: record.id,
    displayId: formatDisplayId(record.id),
    booking: record.booking ? formatDisplayId(record.booking.id) : '—',
    bookingId: record.booking?.id ?? null,
    client: record.booking?.client?.fullName ?? '—',
    clientId: record.booking?.client?.id ?? null,
    worker: record.booking?.worker?.fullName ?? '—',
    workerId: record.booking?.worker?.id ?? null,
    userAmount: totalAmount,
    workerAmount,
    platformFee: commissionAmount,
    method: record.methodType ?? '—',
    date: record.createdAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    status: record.status.charAt(0) + record.status.slice(1).toLowerCase(),
    refundReason: record.refundReason,
    refundedAt: record.refundedAt,
    xenditInvoiceId: record.xenditInvoiceId,
  };
}

function buildPaymentWhere(search: string, status?: string): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = {};

  if (status && status.toLowerCase() !== 'all') {
    where.status = status.toUpperCase() as Prisma.PaymentWhereInput['status'];
  }

  if (search) {
    where.OR = [
      { booking: { id: { contains: search } } },
      { booking: { worker: { fullName: { contains: search } } } },
      { booking: { client: { fullName: { contains: search } } } },
    ];
  }

  return where;
}

export const listPayments = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';

    const where = buildPaymentWhere(search, status);

    const [total, records] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: paymentInclude,
      }),
    ]);

    return res.json({
      success: true,
      data: records.map(formatPayment),
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('List payments error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getPaymentById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const record = await prisma.payment.findUnique({
      where: { id },
      include: paymentInclude,
    });

    if (!record) {
      return res.status(404).json(errorResponse(404, 'Payment not found'));
    }

    return res.json({ success: true, data: formatPayment(record) });
  } catch (error) {
    console.error('Get payment error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/**
 * Payout Distribution — tracks the real Xendit payout lifecycle via
 * the Payout table (created once a Payment's escrow is RELEASED, see
 * paymentLifecycleService.captureAndReleasePayment). Payment.escrowStatus
 * RELEASED means "the worker's cut is owed"; Payout.status PAID means "the
 * worker has actually been sent the money."
 */
const payoutInclude = {
  payment: {
    include: {
      booking: {
        include: {
          worker: { select: { id: true, fullName: true } },
          client: { select: { id: true, fullName: true } },
        },
      },
    },
  },
} satisfies Prisma.PayoutInclude;

type PayoutRecord = Prisma.PayoutGetPayload<{ include: typeof payoutInclude }>;

function buildPayoutWhere(search: string, workerId?: string, status?: string, dateFrom?: string, dateTo?: string): Prisma.PayoutWhereInput {
  const where: Prisma.PayoutWhereInput = {};

  if (workerId) {
    where.workerId = workerId;
  }

  if (status && status.toLowerCase() !== 'all') {
    where.status = status.toUpperCase() as Prisma.PayoutWhereInput['status'];
  }

  if (search) {
    where.payment = { booking: { worker: { fullName: { contains: search } } } };
  }

  if (dateFrom || dateTo) {
    where.paidAt = {
      ...(dateFrom && !isNaN(new Date(dateFrom).getTime()) ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo && !isNaN(new Date(dateTo).getTime()) ? { lte: new Date(dateTo) } : {}),
    };
  }

  return where;
}

function formatPayout(record: PayoutRecord) {
  const booking = record.payment?.booking;
  return {
    id: record.id,
    displayId: formatDisplayId(record.id),
    booking: booking ? formatDisplayId(booking.id) : '—',
    bookingId: booking?.id ?? null,
    worker: booking?.worker?.fullName ?? '—',
    workerId: record.workerId,
    client: booking?.client?.fullName ?? '—',
    payoutAmount: record.amount,
    commissionAmount: record.payment?.commissionAmount ?? null,
    withholdingTaxAmount: record.payment?.withholdingTaxAmount ?? null,
    method: record.channel,
    status: record.status.charAt(0) + record.status.slice(1).toLowerCase(),
    failureReason: record.failureReason,
    attempts: record.attempts,
    xenditDisbursementId: record.xenditDisbursementId,
    xenditStatus: record.xenditStatus,
    releasedAt: record.payment?.releasedAt ?? null,
    paidAt: record.paidAt,
    releasedDate: record.paidAt
      ? record.paidAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : record.payment?.releasedAt
        ? `${record.payment.releasedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (pending)`
        : '—',
  };
}

export const listPayouts = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const workerId = typeof req.query.workerId === 'string' ? req.query.workerId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;

    const where = buildPayoutWhere(search, workerId, status, dateFrom, dateTo);

    const [total, records, aggregate] = await Promise.all([
      prisma.payout.count({ where }),
      prisma.payout.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: payoutInclude,
      }),
      prisma.payout.aggregate({ where, _sum: { amount: true } }),
    ]);

    // Legacy escrow-RELEASED payments from before the Payout table existed
    // have no Payout row at all — surface the count so admins know to
    // reconcile them manually rather than assuming payouts are complete.
    const legacyUnpayoutCount = await prisma.payment.count({
      where: { escrowStatus: 'RELEASED', payout: null },
    });

    return res.json({
      success: true,
      data: records.map(formatPayout),
      meta: {
        ...buildPaginationMeta(total, page, limit),
        totalPayoutAmount: aggregate._sum.amount ?? 0,
        totalPayoutFormatted: formatPeso(aggregate._sum.amount ?? 0),
        legacyUnpayoutCount,
      },
    });
  } catch (error) {
    console.error('List payouts error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

/**
 * PATCH /api/admin/payments/payouts/:id/retry
 * Re-queues a FAILED payout for another disbursement attempt.
 */
export const retryPayout = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const adminId = req.user?.userId;

    const payout = await prisma.payout.findUnique({ where: { id } });
    if (!payout) {
      return res.status(404).json(errorResponse(404, 'Payout not found'));
    }
    if (payout.status !== 'FAILED') {
      return res.status(400).json(errorResponse(400, 'Only a failed payout can be retried'));
    }

    await prisma.payout.update({
      where: { id },
      data: { status: 'PENDING', failureReason: null, failedAt: null },
    });
    await schedulePayout(id);

    await writeAuditLog({
      actorId: adminId,
      action: 'PAYOUT_RETRIED',
      category: 'ADMIN_ACTION',
      message: `Admin retried payout ${id} for booking ${payout.bookingId}`,
      metadata: { payoutId: id, bookingId: payout.bookingId, workerId: payout.workerId },
    });

    return res.json({ success: true, message: 'Payout re-queued' });
  } catch (error) {
    console.error('Retry payout error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

function toCsvValue(value: string | number) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export const exportPayouts = async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const workerId = typeof req.query.workerId === 'string' ? req.query.workerId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;

    const where = buildPayoutWhere(search, workerId, status, dateFrom, dateTo);

    const records = await prisma.payout.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: payoutInclude,
    });

    const rows = records.map(formatPayout);
    const header = ['Payout ID', 'Booking ID', 'Worker', 'Client', 'Payout Amount', 'Commission', 'Withholding Tax', 'Method', 'Status', 'Released Date'];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [r.displayId, r.booking, r.worker, r.client, r.payoutAmount, r.commissionAmount ?? '', r.withholdingTaxAmount ?? '', r.method, r.status, r.releasedDate]
          .map(toCsvValue)
          .join(',')
      ),
    ];

    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payouts-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  } catch (error) {
    console.error('Export payouts error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
