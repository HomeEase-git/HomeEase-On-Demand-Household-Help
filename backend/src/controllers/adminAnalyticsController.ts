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

// The admin's calendar is the Philippines' (UTC+8, no daylight saving), so a
// "month" starts and ends at Manila midnight, not UTC midnight.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-10" -> its Manila-time bounds and day count, or null if it isn't a valid month. */
export function monthRange(month: unknown): { start: Date; end: Date; days: number } | null {
  const match = typeof month === 'string' ? MONTH_PATTERN.exec(month) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, index, 1) - MANILA_OFFSET_MS);
  const end = new Date(Date.UTC(year, index + 1, 1) - MANILA_OFFSET_MS);
  return { start, end, days: Math.round((end.getTime() - start.getTime()) / 86_400_000) };
}

const manilaDateKey = (date: Date) => new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);

/** Bookings created on each day of one month (Manila time), zero-filled. */
export async function getBookingsForMonth(month: { start: Date; end: Date; days: number }) {
  const bookings = await prisma.booking.findMany({
    where: { createdAt: { gte: month.start, lt: month.end } },
    select: { createdAt: true },
  });
  const buckets = new Map<string, number>();
  for (let i = 0; i < month.days; i++) {
    buckets.set(manilaDateKey(new Date(month.start.getTime() + i * 86_400_000)), 0);
  }
  for (const booking of bookings) {
    const key = manilaDateKey(booking.createdAt);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

/** Bookings per service category, for one month or (with no range) all time. */
export async function getBookingsByCategory(range?: { start: Date; end: Date }) {
  const groups = await prisma.booking.groupBy({
    by: ['serviceType'],
    where: range ? { createdAt: { gte: range.start, lt: range.end } } : undefined,
    _count: { _all: true },
  });
  return groups.map((g) => ({ category: g.serviceType, count: g._count._all })).sort((a, b) => b.count - a.count);
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
