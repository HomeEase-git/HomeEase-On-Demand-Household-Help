import type { Request, Response } from 'express';

const mockUserCount = jest.fn();
const mockBookingCount = jest.fn();
const mockPlatformRevenue = jest.fn();
const mockWorkerPayoutsPaid = jest.fn();

jest.mock('@services/financeReportService', () => ({
  platformRevenue: mockPlatformRevenue,
  workerPayoutsPaid: mockWorkerPayoutsPaid,
}));

jest.mock('@config/database', () => ({
  __esModule: true,
  default: {
    user: { count: mockUserCount },
    verificationRequest: { count: jest.fn().mockResolvedValue(0) },
    booking: { count: mockBookingCount, findMany: jest.fn().mockResolvedValue([]) },
    dispute: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    workerProfile: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { commissionOwed: 0 } }),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

import { getDashboardStats } from '../../src/controllers/adminDashboardController';

async function callWith(query: Record<string, string>) {
  const json = jest.fn();
  const res = { json, status: jest.fn(() => ({ json })) } as unknown as Response;
  await getDashboardStats({ query } as unknown as Request, res);
  return json.mock.calls[0][0];
}

// A count/aggregate call's createdAt/releasedAt window, whichever it filters on.
function windowOf(call: [{ where: Record<string, any> }]) {
  const where = call[0].where;
  return where.createdAt ?? where.releasedAt;
}

describe('getDashboardStats range and trends', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserCount.mockResolvedValue(0);
    mockBookingCount.mockResolvedValue(0);
    mockPlatformRevenue.mockResolvedValue({ revenue: 0, fromCashJobs: 0 });
    mockWorkerPayoutsPaid.mockResolvedValue(0);
  });

  it.each([
    ['30', 30],
    ['90', 90],
    ['7', 7],
    ['365', 7],
    ['abc', 7],
    [undefined, 7],
  ])('days=%s gives a %i-day range', async (raw, expected) => {
    const body = await callWith(raw === undefined ? {} : { days: raw });
    expect(body.data.rangeDays).toBe(expected);
    expect(body.data.bookingsTrend).toHaveLength(expected);
  });

  it('compares this period with the one before it', async () => {
    mockUserCount.mockImplementation(async ({ where }) => {
      if (!where.createdAt) return 100; // running totals
      const current = !where.createdAt.lt;
      if (where.role === 'CLIENT') return current ? 12 : 10;
      return current ? 3 : 4;
    });
    // No period = all-time; a period with `lt` = the previous window.
    mockPlatformRevenue.mockImplementation(async (period?: { lt?: Date }) => ({
      revenue: !period ? 5000 : period.lt ? 1000 : 1500,
      fromCashJobs: 0,
    }));
    mockWorkerPayoutsPaid.mockImplementation(async (period?: { lt?: Date }) => (!period ? 4000 : period.lt ? 1200 : 900));

    const body = await callWith({ days: '30' });
    expect(body.data.trends).toMatchObject({
      clients: { current: 12, previous: 10 },
      workers: { current: 3, previous: 4 },
      revenue: { current: 1500, previous: 1000 },
      payouts: { current: 900, previous: 1200 },
    });
    expect(body.data.stats.totalRevenue).toMatch(/5,000/);
    expect(body.data.stats.totalPayouts).toMatch(/4,000/);
  });

  it('uses back-to-back windows of the chosen length', async () => {
    await callWith({ days: '30' });
    const windows = mockUserCount.mock.calls.map(windowOf).filter(Boolean);
    const current = windows.find((w) => !w.lt);
    const previous = windows.find((w) => w.lt);
    const dayMs = 24 * 60 * 60 * 1000;
    expect(previous.lt).toEqual(current.gte);
    expect(current.gte.getTime() - previous.gte.getTime()).toBe(30 * dayMs);
  });
});
