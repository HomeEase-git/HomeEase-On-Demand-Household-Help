import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getBookingsOverTime(days: number): Promise<{ date: string; count: number }[]> {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const bookings = await prisma.booking.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
  });

  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    buckets.set(toDateKey(d), 0);
  }

  for (const booking of bookings) {
    const key = toDateKey(booking.createdAt);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

export const getAnalytics = async (_req: Request, res: Response) => {
  try {
    const [totalBookings, completedBookings, avgRatingResult, categoryGroups, bookingsOverTime] =
      await Promise.all([
        prisma.booking.count(),
        prisma.booking.count({ where: { status: 'COMPLETED' } }),
        prisma.review.aggregate({ _avg: { rating: true } }),
        prisma.booking.groupBy({ by: ['serviceType'], _count: { _all: true } }),
        getBookingsOverTime(30),
      ]);

    const completionRate = totalBookings > 0 ? completedBookings / totalBookings : 0;

    return res.json({
      success: true,
      data: {
        totalBookings,
        completionRate,
        avgRating: avgRatingResult._avg.rating ?? 0,
        bookingsByCategory: categoryGroups
          .map((g) => ({ category: g.serviceType, count: g._count._all }))
          .sort((a, b) => b.count - a.count),
        bookingsOverTime,
      },
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
