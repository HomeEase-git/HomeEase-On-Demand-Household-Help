import prisma from '@config/database';

export interface RemittancePeriodSummary {
  periodStart: Date;
  periodEnd: Date;
  totalTaxWithheld: number;
  status: 'PENDING' | 'REMITTED';
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
  const [aggregate, existing] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'COMPLETED', capturedAt: { gte: periodStart, lt: periodEnd } },
      _sum: { withholdingTaxAmount: true },
    }),
    prisma.taxRemittance.findUnique({
      where: { periodStart_periodEnd: { periodStart, periodEnd } },
    }),
  ]);

  return {
    periodStart,
    periodEnd,
    totalTaxWithheld: aggregate._sum.withholdingTaxAmount ?? 0,
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
