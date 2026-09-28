import prisma from '@config/database';
import { roundToCentavo } from '@utils/money';
import { manilaMonthKey, manilaMonthsIn } from '@utils/manilaTime';

export interface RemittancePeriodSummary {
  periodStart: Date;
  periodEnd: Date;
  totalTaxWithheld: number;
  // Per Manila calendar month: BIR takes the first two months of a quarter on
  // monthly remittance forms and the quarter's total on the quarterly return.
  months: Array<{ month: string; taxWithheld: number }>;
  status: 'PENDING' | 'REMITTED' | 'NEEDS_REVIEW';
  referenceNumber: string | null;
  remittedAt: Date | null;
}

/**
 * Sums withholding tax actually captured (Payment.status COMPLETED) in
 * [periodStart, periodEnd), and pairs it with the existing TaxRemittance row
 * for that period if one exists. There's no public BIR e-filing API — actual
 * filing/payment happens outside the app (eFPS or an authorized bank); this
 * is bookkeeping/audit-trail only, not automation of the filing itself.
 */
export async function summarizeRemittancePeriod(
  periodStart: Date,
  periodEnd: Date
): Promise<RemittancePeriodSummary> {
  const [payments, existing] = await Promise.all([
    prisma.payment.findMany({
      where: { status: 'COMPLETED', capturedAt: { gte: periodStart, lt: periodEnd } },
      select: { withholdingTaxAmount: true, capturedAt: true },
    }),
    prisma.taxRemittance.findUnique({
      where: { periodStart_periodEnd: { periodStart, periodEnd } },
    }),
  ]);

  const byMonth = new Map(manilaMonthsIn(periodStart, periodEnd).map((m) => [m, 0]));
  for (const p of payments) {
    const key = manilaMonthKey(p.capturedAt as Date);
    if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + p.withholdingTaxAmount);
  }
  const months = [...byMonth].map(([month, taxWithheld]) => ({ month, taxWithheld: roundToCentavo(taxWithheld) }));

  return {
    periodStart,
    periodEnd,
    totalTaxWithheld: roundToCentavo(months.reduce((sum, m) => sum + m.taxWithheld, 0)),
    months,
    status: existing?.status ?? 'PENDING',
    referenceNumber: existing?.referenceNumber ?? null,
    remittedAt: existing?.remittedAt ?? null,
  };
}

/**
 * Records that the platform's withheld tax for a period was actually filed
 * and paid to BIR. Upserts so this can be called whether or not a row for
 * the period already exists — `totalTaxWithheld` is recomputed at mark-time
 * so the recorded figure reflects the real aggregate, not a stale client value.
 */
export async function markPeriodRemitted(
  periodStart: Date,
  periodEnd: Date,
  referenceNumber: string,
  remittedByUserId: string,
  notes?: string
) {
  const aggregate = await prisma.payment.aggregate({
    where: { status: 'COMPLETED', capturedAt: { gte: periodStart, lt: periodEnd } },
    _sum: { withholdingTaxAmount: true },
  });

  return prisma.taxRemittance.upsert({
    where: { periodStart_periodEnd: { periodStart, periodEnd } },
    update: {
      totalTaxWithheld: aggregate._sum.withholdingTaxAmount ?? 0,
      status: 'REMITTED',
      referenceNumber,
      remittedAt: new Date(),
      remittedBy: remittedByUserId,
      notes: notes ?? null,
    },
    create: {
      periodStart,
      periodEnd,
      totalTaxWithheld: aggregate._sum.withholdingTaxAmount ?? 0,
      status: 'REMITTED',
      referenceNumber,
      remittedAt: new Date(),
      remittedBy: remittedByUserId,
      notes: notes ?? null,
    },
  });
}
