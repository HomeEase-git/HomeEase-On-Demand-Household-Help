import { Request, Response } from 'express';
import prisma from '@config/database';
import { platformRevenue, workerPayoutsPaid } from '@services/financeReportService';
import { errorResponse } from '@utils/errorResponse';
import { formatDisplayId, formatPeso } from '@utils/formatters';
import { getBookingsOverTime, getBookingsByCategory, getBookingsForMonth, monthRange } from './adminAnalyticsController';

const ACTIVE_BOOKING_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'IN_PROGRESS',
  'QUOTE_SUBMITTED',
  'QUOTE_APPROVED',
  'DISPUTED',
  'PENDING_COMPLETION',
  'AWAITING_PAYMENT',
] as const;

const PAYMENT_OVERDUE_HOURS = 72;

const ALLOWED_RANGE_DAYS = [7, 30, 90] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseRangeDays(raw: unknown): number {
  const days = Number(raw);
  return (ALLOWED_RANGE_DAYS as readonly number[]).includes(days) ? days : 7;
}

type PeriodTrend = { current: number; previous: number };

const TEST_EMAIL_MARKER = 'e2etest';

function activityText(message: string, bookingId: string | undefined): string {
  const withDisplayId = bookingId ? message.split(bookingId).join(formatDisplayId(bookingId)) : message;
  return withDisplayId.replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, (code) => code.toLowerCase().replace(/_/g, ' '));
}

const CATEGORY_LABEL: Record<string, string> = {
  ADMIN_ACTION: 'Admin Actions',
  LOGIN: 'Login History',
  SYSTEM_ERROR: 'System Errors',
  STATUS_CHANGE: 'Status Changes',
};

export const getDashboardCharts = async (req: Request, res: Response) => {
  try {
    const range = monthRange(req.query.month);
    if (!range) {
      return res.status(400).json(errorResponse(400, 'month must look like 2026-10'));
    }
    const [bookingsTrend, bookingsByCategory] = await Promise.all([
      getBookingsForMonth(range),
      getBookingsByCategory(range),
    ]);
    return res.json({ success: true, data: { month: req.query.month, bookingsTrend, bookingsByCategory } });
  } catch (error) {
    console.error('Get dashboard charts error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const days = parseRangeDays(req.query.days);
    const now = Date.now();
    const periodStart = new Date(now - days * DAY_MS);
    const previousStart = new Date(now - 2 * days * DAY_MS);
    const inPeriod = { gte: periodStart };
    const inPrevious = { gte: previousStart, lt: periodStart };

    const [
      totalUsers,
      totalClients,
      totalWorkers,
      pendingApprovals,
      activeBookings,
      openDisputes,
      revenueAllTime,
      payoutsAllTime,
      recentActivityRecords,
      topWorkerRecords,
      bookingsTrend,
      workerDebtResult,
      workersOnHoldCount,
      overduePaymentCount,
    ] = await Promise.all([
      prisma.user.count({ where: { isDeleted: false } }),
      prisma.user.count({ where: { role: 'CLIENT', isDeleted: false } }),
      prisma.user.count({ where: { role: 'WORKER', isDeleted: false } }),
      prisma.verificationRequest.count({ where: { status: 'PENDING' } }),
      prisma.booking.count({ where: { status: { in: [...ACTIVE_BOOKING_STATUSES] } } }),
      prisma.dispute.count({ where: { status: 'OPEN' } }),
      platformRevenue(),
      workerPayoutsPaid(),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      // Unreviewed workers (rating 0) aren't ranked.
      prisma.workerProfile.findMany({
        where: { totalReviews: { gt: 0 }, user: { email: { not: { contains: TEST_EMAIL_MARKER } } } },
        orderBy: [{ rating: 'desc' }, { totalReviews: 'desc' }],
        take: 5,
        include: {
          user: { select: { fullName: true } },
          serviceCategories: { where: { status: 'VERIFIED' }, select: { serviceType: { select: { name: true } } } },
        },
      }),
      getBookingsOverTime(days),
      prisma.workerProfile.aggregate({
        where: { commissionOwed: { gt: 0 } },
        _sum: { commissionOwed: true },
      }),
      prisma.workerProfile.count({ where: { debtHoldAt: { not: null } } }),
      prisma.booking.count({
        where: {
          status: { in: ['PENDING_COMPLETION', 'AWAITING_PAYMENT'] },
          paymentMethodType: { in: ['GCASH', 'MAYA'] },
          workerCompletedAt: { lte: new Date(Date.now() - PAYMENT_OVERDUE_HOURS * 60 * 60 * 1000) },
        },
      }),
    ]);

    const [
      newClients,
      newClientsPrevious,
      newWorkers,
      newWorkersPrevious,
      bookingsCount,
      bookingsCountPrevious,
      revenuePeriod,
      revenuePrevious,
      payoutsPeriod,
      payoutsPrevious,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'CLIENT', isDeleted: false, createdAt: inPeriod } }),
      prisma.user.count({ where: { role: 'CLIENT', isDeleted: false, createdAt: inPrevious } }),
      prisma.user.count({ where: { role: 'WORKER', isDeleted: false, createdAt: inPeriod } }),
      prisma.user.count({ where: { role: 'WORKER', isDeleted: false, createdAt: inPrevious } }),
      prisma.booking.count({ where: { createdAt: inPeriod } }),
      prisma.booking.count({ where: { createdAt: inPrevious } }),
      platformRevenue(inPeriod),
      platformRevenue(inPrevious),
      workerPayoutsPaid(inPeriod),
      workerPayoutsPaid(inPrevious),
    ]);

    const trend = (current: number, previous: number): PeriodTrend => ({ current, previous });
    const trends = {
      clients: trend(newClients, newClientsPrevious),
      workers: trend(newWorkers, newWorkersPrevious),
      bookings: trend(bookingsCount, bookingsCountPrevious),
      revenue: trend(revenuePeriod.revenue, revenuePrevious.revenue),
      payouts: trend(payoutsPeriod, payoutsPrevious),
    };

    return res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalClients,
          totalWorkers,
          pendingApprovals,
          activeBookings,
          openDisputes,
          totalRevenue: formatPeso(revenueAllTime.revenue),
          revenueFromCashJobs: formatPeso(revenueAllTime.fromCashJobs),
          totalPayouts: formatPeso(payoutsAllTime),
          outstandingWorkerDebt: formatPeso(workerDebtResult._sum.commissionOwed ?? 0),
          workersOnHoldCount,
          overduePayments: overduePaymentCount,
        },
        recentActivity: recentActivityRecords.map((record) => {
          const bookingId = (record.metadata as { bookingId?: unknown } | null)?.bookingId;
          const linkedBookingId = typeof bookingId === 'string' ? bookingId : undefined;
          return {
            id: record.id,
            bookingId: linkedBookingId ?? null,
            text: activityText(record.message, linkedBookingId),
            category: CATEGORY_LABEL[record.category] ?? record.category,
            time: record.createdAt.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            }),
          };
        }),
        topWorkers: topWorkerRecords.map((worker) => ({
          id: worker.userId,
          name: worker.user.fullName,
          services: worker.serviceCategories.map((c) => c.serviceType.name).join(', ') || '—',
          rating: worker.rating.toFixed(1),
          reviews: worker.totalReviews,
        })),
        bookingsTrend,
        rangeDays: days,
        trends,
      },
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
