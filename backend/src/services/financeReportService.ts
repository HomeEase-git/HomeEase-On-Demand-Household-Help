import prisma from '@config/database';
import type { Prisma } from '@prisma/client';
import { roundToCentavo } from '@utils/money';

/**
 * The one definition of the platform's money figures, shared by the admin
 * dashboard and the Payments page so they can't drift apart again.
 *
 *  - Revenue is the platform's COMMISSION — not what clients paid. The rest of
 *    a client payment is the worker's share, withholding tax held for BIR, VAT
 *    and tips, none of which is the platform's income. Cash-job commission
 *    counts too (the worker owes it as dues). Platform-funded payments are
 *    left out: no client paid, so there is nothing earned — they show up as a
 *    cost instead.
 *  - A payment counts in the period its money was captured (capturedAt, not
 *    when the invoice was created). A later refund takes its commission back
 *    out in the period of the refund, so a closed period's figure never
 *    changes afterwards.
 *  - Worker payouts are money actually sent: Payout rows marked PAID, in the
 *    period they were paid. Cash jobs never produce one (the client paid the
 *    worker in person).
 */

export interface Period {
  gte?: Date;
  lt?: Date;
}

// Old rows without capturedAt fall back to createdAt.
function capturedIn(period?: Period): Prisma.PaymentWhereInput {
  if (!period) return {};
  return {
    OR: [{ capturedAt: period }, { capturedAt: null, createdAt: period }],
  };
}

const clientFunded: Prisma.PaymentWhereInput = { platformFunded: false };

export interface RevenueFigures {
  revenue: number; // net commission: earned in the period minus refunded in the period
  commissionEarned: number;
  commissionRefunded: number;
  fromOnlineJobs: number; // GCash/Maya — collected with the payment
  fromCashJobs: number; // owed by the worker as dues
}

export async function platformRevenue(period?: Period): Promise<RevenueFigures> {
  const earnedWhere: Prisma.PaymentWhereInput = {
    ...clientFunded,
    // A payment later refunded was still earned when captured; its refund is
    // subtracted separately in the refund's own period.
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

/** Money actually sent to workers' GCash/Maya accounts. */
export async function workerPayoutsPaid(period?: Period): Promise<number> {
  const result = await prisma.payout.aggregate({
    where: { status: 'PAID', ...(period ? { paidAt: period } : {}) },
    _sum: { amount: true },
  });
  return roundToCentavo(result._sum.amount ?? 0);
}

/** Worker earnings the platform paid out of its own funds (client never paid). */
export async function platformFundedCost(period?: Period): Promise<number> {
  const result = await prisma.payment.aggregate({
    where: { platformFunded: true, status: 'COMPLETED', ...capturedIn(period) },
    _sum: { workerPayout: true },
  });
  return roundToCentavo(result._sum.workerPayout ?? 0);
}

/**
 * Breakdown of completed client payments matching `where` — what clients
 * paid, and where each peso of it goes.
 */
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
    // Commission as a share of the service price it's charged on.
    commissionRatePercent: subtotal > 0 ? Math.round((commission / subtotal) * 1000) / 10 : null,
  };
}
