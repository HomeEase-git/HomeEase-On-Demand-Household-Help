import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatDisplayId, formatPeso } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';

function buildBookingWhere(search: string, status?: string): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = {};

  if (status && status !== 'all') {
    where.status = status.toUpperCase() as Prisma.BookingWhereInput['status'];
  }

  if (search) {
    where.OR = [
      { serviceTask: { name: { contains: search } } },
      { client: { fullName: { contains: search } } },
      { worker: { fullName: { contains: search } } },
    ];
  }

  return where;
}

function formatBooking(record: {
  id: string;
  finalPrice: number | null;
  estimatedPrice: number;
  client?: { fullName: string } | null;
  worker?: { fullName: string } | null;
  serviceTask?: { name: string } | null;
  scheduledDate: Date | null;
  createdAt: Date;
  status: string;
}) {
  const amount = record.finalPrice ?? record.estimatedPrice ?? null;

  return {
    id: record.id,
    displayId: formatDisplayId(record.id),
    client: record.client?.fullName ?? '—',
    worker: record.worker?.fullName ?? '—',
    service: record.serviceTask?.name ?? '—',
    date: record.scheduledDate
      ? record.scheduledDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : record.createdAt.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
    amount: amount != null ? formatPeso(amount) : '—',
    status: record.status.charAt(0) + record.status.slice(1).toLowerCase(),
  };
}

export const listBookings = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.toLowerCase() : 'all';

    const where = buildBookingWhere(search, status);

    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { fullName: true } },
          worker: { select: { fullName: true } },
          serviceTask: { select: { name: true } },
        },
      }),
    ]);

    return res.json({
      success: true,
      data: bookings.map(formatBooking),
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('List bookings error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getBookingById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, fullName: true, email: true } },
        worker: { select: { id: true, fullName: true, email: true } },
        serviceTask: { select: { name: true } },
      },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    return res.json({
      success: true,
      data: {
        id: booking.id,
        displayId: formatDisplayId(booking.id),
        client: booking.client.fullName,
        clientId: booking.client.id,
        worker: booking.worker?.fullName ?? '—',
        workerId: booking.worker?.id ?? null,
        service: booking.serviceTask?.name ?? '—',
        date: booking.scheduledDate
          ? booking.scheduledDate.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : booking.createdAt.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            }),
        status: booking.status.charAt(0) + booking.status.slice(1).toLowerCase(),
        amount:
          (booking.finalPrice ?? booking.estimatedPrice) != null
            ? formatPeso(booking.finalPrice ?? booking.estimatedPrice)
            : '—',
      },
    });
  } catch (error) {
    console.error('Get booking error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
