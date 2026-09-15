import prisma from '@config/database';

export interface VatSummaryGenerationResult {
  generated: number; // includes zero-VAT workers skipped below
  skippedNoVat: number; // workers with payments in the period but none VAT-applicable
}

/**
 * Aggregates Payment.vatAmount (never Payout.amount — a cash job's debt
 * clawback can make those differ, see paymentLifecycleService) per worker
 * for [periodStart, periodEnd), upserting one VatCollectionSummary row per
 * worker+period (idempotent, safe to re-run for the same period).
 *
 * This is informational only — see VatCollectionSummary's schema comment.
 * The platform never remits this; it exists so a VAT-registered worker has
 * a clean number for their own 2550Q/2551Q filing.
 */
export async function generateVatSummaries(
  periodStart: Date,
  periodEnd: Date,
  generatedByUserId: string
): Promise<VatSummaryGenerationResult> {
  const payments = await prisma.payment.findMany({
    where: {
      status: 'COMPLETED',
      vatApplicable: true,
      // Platform-funded settlements (PAY_WORKER_FROM_PLATFORM) never
      // actually collected anything from a client — nothing to report here.
      platformFunded: false,
      capturedAt: { gte: periodStart, lt: periodEnd },
    },
    select: {
      vatAmount: true,
      booking: { select: { workerId: true } },
    },
  });

  const byWorker = new Map<string, number>();
  for (const payment of payments) {
    const workerId = payment.booking.workerId;
    if (!workerId) continue;
    byWorker.set(workerId, (byWorker.get(workerId) ?? 0) + payment.vatAmount);
  }

  const result: VatSummaryGenerationResult = { generated: 0, skippedNoVat: 0 };

  for (const [workerId, totalVatCollected] of byWorker) {
    if (totalVatCollected <= 0) {
      result.skippedNoVat++;
      continue;
    }

    const user = await prisma.user.findUnique({ where: { id: workerId }, select: { fullName: true } });
    if (!user) continue;

    await prisma.vatCollectionSummary.upsert({
      where: { workerId_periodStart_periodEnd: { workerId, periodStart, periodEnd } },
      update: {
        workerName: user.fullName,
        totalVatCollected: Math.round(totalVatCollected * 100) / 100,
        generatedBy: generatedByUserId,
      },
      create: {
        workerId,
        periodStart,
        periodEnd,
        workerName: user.fullName,
        totalVatCollected: Math.round(totalVatCollected * 100) / 100,
        generatedBy: generatedByUserId,
      },
    });

    result.generated++;
  }

  return result;
}
