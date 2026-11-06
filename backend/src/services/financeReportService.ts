import prisma from '@config/database';
import type { Prisma } from '@prisma/client';
import { roundToCentavo } from '@utils/money';

export interface Period {
  gte?: Date;
  lt?: Date;
}

function capturedIn(period?: Period): Prisma.PaymentWhereInput {
  if (!period) return {};
  return {
    OR: [{ capturedAt: period }, { capturedAt: null, createdAt: period }],
  };
}

const clientFunded: Prisma.PaymentWhereInput = { platformFunded: false };

export interface RevenueFigures {
  revenue: number;
  commissionEarned: number;
  commissionRefunded: number;
  fromOnlineJobs: number; // GCash/Maya — collected with the payment
  fromCashJobs: number; // owed by the worker as dues
}

export async function platformRevenue(period?: Period): Promise<RevenueFigures> {
  const earnedWhere: Prisma.PaymentWhereInput = {
    ...clientFunded,
    status: { in: ['COMPLETED', 'REFUNDED'] },
    ...capturedIn(period),
  };
  const [online, cash, refunded] = await Promise.all([
    prisma.payment.aggregate({
      where: { ...earnedWhere, methodType: { not: 'CASH' } },
      _sum: { commissionAmount: true },
    }),
    prisma.payment.aggregate({ where: { ...earnedWhere, methodType: 'CASH' }, _sum: { commissionAmount: true } }),
    prisma.payment.aggregate({
      where: { ...clientFunded, status: 'REFUNDED', ...(period ? { refundedAt: period } : {}) },
      _sum: { commissionAmount: true },
    }),
  ]);

  const fromOnlineJobs = online._sum.commissionAmount ?? 0;
  const fromCashJobs = cash._sum.commissionAmount ?? 0;
  const commissionEarned = roundToCentavo(fromOnlineJobs + fromCashJobs);
  const commissionRefunded = roundToCentavo(refunded._sum.commissionAmount ?? 0);
  return {
    revenue: roundToCentavo(commissionEarned - commissionRefunded),
    commissionEarned,
    commissionRefunded,
    fromOnlineJobs: roundToCentavo(fromOnlineJobs),
    fromCashJobs: roundToCentavo(fromCashJobs),
  };
}

export async function workerPayoutsPaid(period?: Period): Promise<number> {
  const result = await prisma.payout.aggregate({
    where: { status: 'PAID', ...(period ? { paidAt: period } : {}) },
    _sum: { amount: true },
  });
  return roundToCentavo(result._sum.amount ?? 0);
}

export async function platformFundedCost(period?: Period): Promise<number> {
  const result = await prisma.payment.aggregate({
    where: { platformFunded: true, status: 'COMPLETED', ...capturedIn(period) },
    _sum: { workerPayout: true },
  });
  return roundToCentavo(result._sum.workerPayout ?? 0);
}

export async function paymentBreakdown(where: Prisma.PaymentWhereInput) {
  const result = await prisma.payment.aggregate({
    where: { ...where, ...clientFunded, status: 'COMPLETED' },
    _sum: {
      totalAmount: true,
      subtotal: true,
      tip: true,
      commissionAmount: true,
      withholdingTaxAmount: true,
      vatAmount: true,
      workerPayout: true,
    },
  });
  const s = result._sum;
  const subtotal = s.subtotal ?? 0;
  const commission = s.commissionAmount ?? 0;
  return {
    clientPaid: roundToCentavo(s.totalAmount ?? 0),
    workerEarnings: roundToCentavo(s.workerPayout ?? 0), // after commission and withholding tax, incl. tips
    platformCommission: roundToCentavo(commission),
    withholdingTax: roundToCentavo(s.withholdingTaxAmount ?? 0), // held for BIR, not income
    vatCollected: roundToCentavo(s.vatAmount ?? 0), // owed to BIR, not income
    tips: roundToCentavo(s.tip ?? 0),
    commissionRatePercent: subtotal > 0 ? Math.round((commission / subtotal) * 1000) / 10 : null,
  };
}
