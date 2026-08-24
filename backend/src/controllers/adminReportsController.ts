import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';

function sevenDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

export const getServiceReport = async (_req: Request, res: Response) => {
  try {
    const [popularityGroups, totalBookings, completed, cancelled, disputed, regionalGroups, avgRatingResult] =
      await Promise.all([
        prisma.booking.groupBy({ by: ['serviceType'], _count: { _all: true } }),
        prisma.booking.count(),
        prisma.booking.count({ where: { status: 'COMPLETED' } }),
        prisma.booking.count({ where: { status: 'CANCELLED' } }),
        prisma.booking.count({ where: { status: 'DISPUTED' } }),
        prisma.booking.groupBy({
          by: ['city'],
          _count: { _all: true },
          orderBy: { _count: { city: 'desc' } },
          take: 5,
        }),
        prisma.review.aggregate({ _avg: { rating: true } }),
      ]);

    const popularity = popularityGroups
      .map((g) => {
        const pct = totalBookings > 0 ? Math.round((g._count._all / totalBookings) * 100) : 0;
        return `${g.serviceType} (${pct}%)`;
      })
      .join(', ') || 'No bookings yet';

    const pct = (n: number) => (totalBookings > 0 ? Math.round((n / totalBookings) * 100) : 0);

    const regional =
      regionalGroups.map((g) => `${g.city} (${g._count._all})`).join(', ') || 'No bookings yet';

    return res.json({
      success: true,
      data: [
        { metric: 'Popularity', value: popularity },
        {
          metric: 'Completion Rate',
          value: `Completed: ${pct(completed)}% · Cancelled: ${pct(cancelled)}% · Disputed: ${pct(disputed)}%`,
        },
        { metric: 'Regional Data', value: regional },
        { metric: 'Average Rating', value: `${(avgRatingResult._avg.rating ?? 0).toFixed(1)} / 5 (overall)` },
      ],
    });
  } catch (error) {
    console.error('Get service report error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getActivityReport = async (_req: Request, res: Response) => {
  try {
    const since = sevenDaysAgo();

    const [newClients, newWorkers, activeClientBookings, declineGroups, scheduledTimes] = await Promise.all([
      prisma.user.count({ where: { role: 'CLIENT', createdAt: { gte: since } } }),
      prisma.user.count({ where: { role: 'WORKER', createdAt: { gte: since } } }),
      prisma.booking.findMany({
        where: { createdAt: { gte: since } },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
      prisma.auditLog.groupBy({
        by: ['actorId', 'actorName'],
        where: { action: 'BOOKING_DECLINED' },
        _count: { _all: true },
      }),
      // Scoped to the same 7-day window as the other metrics in this report —
      // previously unbounded, so it scanned the entire bookings table.
      prisma.booking.findMany({
        where: { scheduledTime: { not: null }, createdAt: { gte: since } },
        select: { scheduledTime: true },
      }),
    ]);

    const totalDeclines = declineGroups.reduce((sum, g) => sum + g._count._all, 0);
    const topDecliner = [...declineGroups].sort((a, b) => b._count._all - a._count._all)[0];

    const buckets = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
    for (const b of scheduledTimes) {
      const hour = Number(b.scheduledTime?.split(':')[0] ?? NaN);
      if (Number.isNaN(hour)) continue;
      if (hour >= 6 && hour < 12) buckets.Morning++;
      else if (hour >= 12 && hour < 18) buckets.Afternoon++;
      else if (hour >= 18 && hour < 24) buckets.Evening++;
      else buckets.Night++;
    }
    const peakBucket = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'N/A';

    return res.json({
      success: true,
      data: [
        { metric: 'Engagement', value: `New users this week: ${newClients} · New workers: ${newWorkers}` },
        { metric: 'Activity', value: `Users: ${activeClientBookings.length} clients booked this week` },
        {
          metric: 'Worker Reliability',
          value:
            totalDeclines > 0
              ? `Declines: ${totalDeclines} total · Most declines: ${topDecliner?.actorName ?? '—'} (${topDecliner?._count._all ?? 0})`
              : 'No declines recorded yet',
        },
        { metric: 'App Usage', value: `Peak booking time: ${peakBucket}` },
      ],
    });
  } catch (error) {
    console.error('Get activity report error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
