import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { parseListSort } from '@utils/listSort';
import { errorResponse } from '@utils/errorResponse';
import { bookingStartTime, formatTime12h } from '@services/workerAvailabilityService';
import { formatDisplayId, formatPeso } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import { sendSmsToUser } from '@utils/smsService';
import { requestRefund } from '@services/refundRequestService';
import { updateBookingIfStatus, isBookingStatusConflict } from '@services/bookingStatusWrite';
import { cancelPendingExpiryJob } from '@queues/bookingQueue';
import { describeDistanceFee } from '@utils/pricing';
import { getAppSettings } from '@services/appSettingsService';
import { invoiceLines, invoiceStatus } from '@utils/invoiceItems';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

function buildBookingWhere(search: string, status?: string, dateFrom?: string, dateTo?: string): Prisma.BookingWhereInput {
  // Archived bookings only show under their own tab.
  const where: Prisma.BookingWhereInput = { archivedAt: status === 'archived' ? { not: null } : null };

  if (status && status !== 'all' && status !== 'archived') {
    where.status = status.toUpperCase() as Prisma.BookingWhereInput['status'];
  }

  if (search) {
    where.OR = [
      { serviceTask: { name: { contains: search, mode: 'insensitive' } } },
      { client: { fullName: { contains: search, mode: 'insensitive' } } },
      { worker: { fullName: { contains: search, mode: 'insensitive' } } },
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
  selfDealingFlag?: boolean;
  archivedAt?: Date | null;
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
    // Client and assigned worker share a phone number — see
    // Booking.selfDealingFlag's schema comment. Advisory only.
    selfDealingFlag: record.selfDealingFlag ?? false,
    archived: record.archivedAt != null,
  };
}

export const listBookings = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    // Server-side so the order covers every page, not just the visible one.
    const { orderBy } = parseListSort<Prisma.BookingOrderByWithRelationInput>(
      req.query,
      {
        created: (dir) => ({ createdAt: dir }),
        date: (dir) => ({ scheduledDate: dir }),
        client: (dir) => ({ client: { fullName: dir } }),
        worker: (dir) => ({ worker: { fullName: dir } }),
      },
      { key: 'created', dir: 'desc' },
    );
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
        orderBy,
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
        cancellation: true,
        visits: { orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }] },
        addOns: { orderBy: { createdAt: 'asc' } },
        quoteItems: { orderBy: { createdAt: 'asc' } },
        pricingLogs: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });

    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    const bookingLog = booking.pricingLogs[0] ?? null;

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
        // PH calendar date + exact start time.
        date: `${booking.scheduledDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}, ${formatTime12h(bookingStartTime(booking))}`,
        status: booking.status.charAt(0) + booking.status.slice(1).toLowerCase(),
        amount:
          (booking.finalPrice ?? booking.estimatedPrice) != null
            ? formatPeso(booking.finalPrice ?? booking.estimatedPrice)
            : '—',
        selfDealingFlag: booking.selfDealingFlag,
        // Exact PH start time (bookings before exact times show their old slot's start).
        startTime: bookingStartTime(booking),
        isRush: booking.isRush,
        rushFee: bookingLog?.rushFee ?? 0,
        // Booking-time price split, shown for every status (cancelled too).
        pricing: bookingLog
          ? {
              basePrice: bookingLog.basePrice,
              distanceFee: bookingLog.distanceFee ?? 0,
              distanceFeeNote: describeDistanceFee(bookingLog, await getAppSettings()),
              tierFee: bookingLog.tierFee ?? 0,
              rushFee: bookingLog.rushFee ?? 0,
              addOnsTotal: bookingLog.addOnsTotal ?? 0,
              estimate: bookingLog.finalEstimate,
            }
          : null,
        parentBookingId: booking.parentBookingId,
        workerArrivedAt: booking.workerArrivedAt,
        beforePhotoUrls: booking.beforePhotoUrls,
        progressPhotoUrls: booking.progressPhotoUrls,
        completionPhotoUrl: booking.completionPhotoUrl,
        visits: booking.visits.map((v) => ({
          id: v.id,
          date: v.scheduledDate.toISOString().slice(0, 10),
          time: v.scheduledTime,
          status: v.status,
          notes: v.notes,
        })),
        // The worker's invoice (sent at completion): the job, packages, parts
        // and extra work, with their photos.
        invoice: {
          status: invoiceStatus(booking.status, booking.workerCompletedAt),
          sentAt: booking.workerCompletedAt,
          lines: invoiceLines(booking),
        },
        cancellation: booking.cancellation
          ? {
              cancelledBy: booking.cancellation.cancelledBy,
              reason: booking.cancellation.reason,
              fault: booking.cancellation.fault,
              proofUrls: booking.cancellation.proofUrls,
              penaltyAmount: booking.cancellation.penaltyAmount,
              compensationAmount: booking.cancellation.compensationAmount,
              compensationStatus: booking.cancellation.compensationStatus,
              reviewNote: booking.cancellation.reviewNote,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Get booking error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'];

/**
 * PATCH /api/admin/bookings/:id/archive  { archived: boolean }
 * Hides (or restores) a finished booking in the admin list. Active bookings
 * can't be archived, so nothing in progress drops out of view.
 */
export const setBookingArchived = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { archived } = req.body as { archived?: unknown };
    if (typeof archived !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'archived must be true or false'));
    }

    const booking = await prisma.booking.findUnique({ where: { id }, select: { status: true } });
    if (!booking) {
      return res.status(404).json(errorResponse(404, 'Booking not found'));
    }
    if (archived && !TERMINAL_STATUSES.includes(booking.status)) {
      return res.status(409).json(errorResponse(409, 'Only completed, cancelled or rejected bookings can be archived'));
    }

    await prisma.booking.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: archived ? 'BOOKING_ARCHIVED' : 'BOOKING_UNARCHIVED',
      category: 'ADMIN_ACTION',
      message: `Booking ${formatDisplayId(id)} ${archived ? 'archived' : 'restored from archive'}`,
    });

    return res.json({ success: true, data: { id, archived } });
  } catch (error) {
    console.error('Archive booking error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

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
        await tx.workerProfile.update({
          where: { userId: booking.workerId },
          data: { activeJobCount: { decrement: 1 } },
        });
      }
      await tx.bookingVisit.updateMany({ where: { bookingId: id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });

      // Same as bookingController.cancelBooking — an open dispute on a
      // booking cancelled from here has nothing left to resolve.
      await tx.dispute.updateMany({
        where: { bookingId: id, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
        data: {
          status: 'RESOLVED_DISMISSED',
          resolution: 'Booking was cancelled by an admin outside dispute resolution',
          resolvedById: adminId,
          resolvedAt: new Date(),
        },
      });

      await tx.cancellation.create({
        data: {
          bookingId: id,
          cancelledBy: 'ADMIN',
          cancelledById: adminId ?? 'system',
          reason: reason?.trim() || 'Cancelled by admin',
        },
      });

      // Status-guarded: rolls the whole cancel back if the booking moved on
      // (e.g. completed or paid) since it was read.
      await updateBookingIfStatus(tx, id, booking.status, { status: 'CANCELLED', notes: reason?.trim() || booking.notes });
    });

    // Best-effort — the cancel already committed above, same reasoning as
    // the client-facing cancelBooking/acceptBooking/declineBooking handlers.
    await cancelPendingExpiryJob(id).catch((error) => {
      console.error(`Failed to cancel pending-expiry job for admin-cancelled booking ${id}:`, error);
    });
    // A paid booking's refund goes to the Refunds page for approval.
    await requestRefund({
      bookingId: id,
      reason: reason?.trim() || 'Cancelled by admin',
      source: 'ADMIN_CANCEL',
      requestedById: adminId,
    }).catch((error) => {
      console.error(`Failed to void/refund-request payment for admin-cancelled booking ${id}:`, error);
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
    if (isBookingStatusConflict(error)) {
      return res.status(409).json(errorResponse(409, 'This booking was just updated. Refresh and try again.'));
    }
    console.error('Admin cancel booking error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
