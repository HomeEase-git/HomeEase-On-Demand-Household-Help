import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatDisplayId } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';

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
