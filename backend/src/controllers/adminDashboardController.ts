import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatPeso } from '@utils/formatters';
import { getBookingsOverTime } from './adminAnalyticsController';

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

const CATEGORY_LABEL: Record<string, string> = {
  ADMIN_ACTION: 'Admin Actions',
  LOGIN: 'Login History',
  SYSTEM_ERROR: 'System Errors',
  STATUS_CHANGE: 'Status Changes',
};

export const getDashboardStats = async (_req: Request, res: Response) => {
  try {
    const [
      totalUsers,
      totalClients,
      totalWorkers,
      pendingApprovals,
      activeBookings,
      openDisputes,
      revenueResult,
      payoutResult,
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
      prisma.payment.aggregate({ where: { status: 'COMPLETED' }, _sum: { totalAmount: true } }),
      prisma.payment.aggregate({ where: { escrowStatus: 'RELEASED' }, _sum: { workerPayout: true } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.workerProfile.findMany({
        orderBy: [{ rating: 'desc' }, { totalReviews: 'desc' }],
        take: 5,
        include: {
          user: { select: { fullName: true } },
          serviceTypes: { select: { name: true } },
        },
      }),
      getBookingsOverTime(7),
      // Total commission/tax owed by workers from cash jobs.
      prisma.workerProfile.aggregate({
        where: { commissionOwed: { gt: 0 } },
        _sum: { commissionOwed: true },
      }),
      prisma.workerProfile.count({ where: { debtHoldAt: { not: null } } }),
      // GCash/Maya jobs finished but unpaid past the escalation threshold.
      prisma.booking.count({
        where: {
          status: { in: ['PENDING_COMPLETION', 'AWAITING_PAYMENT'] },
          paymentMethodType: { in: ['GCASH', 'MAYA'] },
          workerCompletedAt: { lte: new Date(Date.now() - PAYMENT_OVERDUE_HOURS * 60 * 60 * 1000) },
        },
      }),
    ]);

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
          totalRevenue: formatPeso(revenueResult._sum.totalAmount ?? 0),
          totalPayouts: formatPeso(payoutResult._sum.workerPayout ?? 0),
          outstandingWorkerDebt: formatPeso(workerDebtResult._sum.commissionOwed ?? 0),
          workersOnHoldCount,
          overduePayments: overduePaymentCount,
        },
        recentActivity: recentActivityRecords.map((record) => ({
          id: record.id,
          text: record.message,
          category: CATEGORY_LABEL[record.category] ?? record.category,
          time: record.createdAt.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }),
        })),
        topWorkers: topWorkerRecords.map((worker) => ({
          id: worker.id,
          name: worker.user.fullName,
          services: worker.serviceTypes.map((s) => s.name).join(', ') || '—',
          rating: worker.rating.toFixed(1),
          reviews: worker.totalReviews,
        })),
        bookingsTrend,
      },
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
