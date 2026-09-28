import prisma from '@config/database';
import { roundToCentavo } from '@utils/money';
import { manilaMonthKey, manilaMonthsIn } from '@utils/manilaTime';
import { postLedger, toCentavos } from '@services/ledgerService';

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

  const record = await prisma.taxRemittance.upsert({
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

  await postRemittedWithholding(record.id, record.totalTaxWithheld, record.referenceNumber ?? referenceNumber);
  return record;
}

/**
 * Takes the remitted tax off WITHHOLDING_TAX_PAYABLE (paid to BIR outside
 * the app). A quarter re-marked with a corrected figure posts only the
 * difference, so the ledger always shows what was actually remitted.
 */
async function postRemittedWithholding(remittanceId: string, totalPesos: number, referenceNumber: string) {
  const prefix = `tax-remitted:${remittanceId}`;
  const already = await prisma.ledgerLine.aggregate({
    where: { account: 'WITHHOLDING_TAX_PAYABLE', transaction: { idempotencyKey: { startsWith: prefix } } },
    _sum: { amountCentavos: true },
  });
  const delta = toCentavos(totalPesos) - (already._sum.amountCentavos ?? 0);
  if (delta === 0) return;
  await postLedger(prisma, {
    type: 'TAX_REMITTED',
    key: `${prefix}:${toCentavos(totalPesos)}`,
    memo: `Withholding tax remitted to BIR (ref ${referenceNumber})`,
    lines: [
      { account: 'WITHHOLDING_TAX_PAYABLE', amountCentavos: delta },
      { account: 'MANUAL_SETTLEMENTS', amountCentavos: -delta },
    ],
  });
}
