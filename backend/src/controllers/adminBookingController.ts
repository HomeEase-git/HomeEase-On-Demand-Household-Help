import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatDisplayId, formatPeso } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { refundOrVoidPayment } from '@services/paymentLifecycleService';
import { freeSlot } from '@services/workerAvailabilityService';
import { cancelPendingExpiryJob } from '@queues/bookingQueue';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

function buildBookingWhere(search: string, status?: string, dateFrom?: string, dateTo?: string): Prisma.BookingWhereInput {
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

  if (dateFrom || dateTo) {
    where.scheduledDate = {
      ...(dateFrom && !isNaN(new Date(dateFrom).getTime()) ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo && !isNaN(new Date(dateTo).getTime()) ? { lte: new Date(dateTo) } : {}),
    };
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
  urgencyLevel?: string;
}) {
  const amount = record.finalPrice ?? record.estimatedPrice ?? null;

  return {
    id: record.id,
    displayId: formatDisplayId(record.id),
    client: record.client?.fullName ?? '—',
    worker: record.worker?.fullName ?? '—',
    service: record.serviceTask?.name ?? '—',
    urgencyLevel: record.urgencyLevel ?? 'STANDARD',
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
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;

    const where = buildBookingWhere(search, status, dateFrom, dateTo);

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
        urgencyLevel: booking.urgencyLevel,
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

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

/**
 * PATCH /api/admin/bookings/:id/cancel
 * Admin override — cancels a booking in any non-terminal state, writes a
 * Cancellation audit record, frees the worker's capacity/calendar slot if
 * one was held, and releases/refunds the payment hold.
 */
export const cancelBookingAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body as { reason?: string };
    const adminId = req.user?.userId;

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }

    if (TERMINAL_STATUSES.includes(booking.status)) {
      return res.status(409).json(errorResponse(409, `Cannot cancel a booking with status ${booking.status}`));
    }

    await prisma.$transaction(async (tx) => {
      if (['ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED', 'DISPUTED'].includes(booking.status) && booking.workerId) {
        const workerProfile = await tx.workerProfile.update({
          where: { userId: booking.workerId },
          data: { activeJobCount: { decrement: 1 } },
        });
        if (booking.timeSlot) {
          await freeSlot(tx, workerProfile.id, booking.scheduledDate, booking.timeSlot);
        }
      }

      await tx.cancellation.create({
        data: {
          bookingId: id,
          cancelledBy: 'ADMIN',
          cancelledById: adminId ?? 'system',
          reason: reason?.trim() || 'Cancelled by admin',
        },
      });

      await tx.booking.update({
        where: { id },
        data: { status: 'CANCELLED', notes: reason?.trim() || booking.notes },
      });
    });

    // Best-effort — the cancel already committed above, same reasoning as
    // the client-facing cancelBooking/acceptBooking/declineBooking handlers.
    await cancelPendingExpiryJob(id).catch((error) => {
      console.error(`Failed to cancel pending-expiry job for admin-cancelled booking ${id}:`, error);
    });
    await refundOrVoidPayment(id, reason?.trim() || 'Cancelled by admin').catch((error) => {
      console.error(`Failed to refund payment for admin-cancelled booking ${id}:`, error);
    });

    await writeAuditLog({
      actorId: adminId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'BOOKING_CANCELLED_BY_ADMIN',
      category: 'ADMIN_ACTION',
      message: `Booking ${formatDisplayId(id)} cancelled by admin${reason ? `: ${reason}` : ''}`,
    });

    const partiesToNotify = [booking.clientId, booking.workerId].filter((v): v is string => Boolean(v));
    const cancelledMessage = `This booking was cancelled by an administrator${reason ? `: ${reason}` : ''}`;
    await Promise.all(
      partiesToNotify.map((userId) =>
        notifyUser({
          userId,
          type: 'BOOKING_CANCELLED',
          title: 'Booking Cancelled',
          message: cancelledMessage,
          relatedId: id,
        })
      )
    );
    for (const userId of partiesToNotify) {
      void sendSmsToUser({ userId, message: `HomeEase: ${cancelledMessage}` });
    }

    return res.json({ success: true, data: { id, status: 'CANCELLED' } });
  } catch (error) {
    console.error('Admin cancel booking error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
