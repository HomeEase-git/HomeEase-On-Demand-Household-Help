import prisma from '@config/database';
import { Prisma } from '@prisma/client';
import { notifyUser } from '@utils/notify';
import { writeAuditLog } from '@utils/auditLog';

// BIR's mandatory VAT-registration threshold — annual gross receipts, not
// net/take-home. Workers are legally required to register once they cross
// it regardless of trade (see WorkerProfile.vatRegistered's schema
// comment). Previously nothing in the platform ever checked this even
// though every Payment row needed to compute it already exists — a
// high-volume worker could stay "non-VAT" indefinitely with no one ever
// told they'd crossed it.
const VAT_REGISTRATION_THRESHOLD = 3_000_000;

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
        // A regeneration recomputes from the live Payment rows, so it
        // reflects reality again regardless of why it was flagged (see
        // flagTaxRecordsForRefundedPayment) — clear the flag rather than
        // leaving a stale warning on an otherwise-correct summary.
        needsReview: false,
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

/**
 * Scheduled sweep (see internalCron.ts's 'flag-vat-threshold' task, hit
 * hourly alongside the other booking-lifecycle sweeps) — sums each
 * non-VAT-registered worker's trailing-12-month Payment.subtotal (gross
 * receipts, not just what they kept after commission) via a single grouped
 * query rather than one aggregate per worker, and flags anyone who crosses
 * VAT_REGISTRATION_THRESHOLD. Advisory only: notifies the worker + every
 * admin and stamps WorkerProfile.vatThresholdFlaggedAt so this doesn't
 * re-fire every single hour once already flagged — never touches
 * vatRegistered itself, which stays admin-approved-only.
 */
export async function flagWorkersOverVatThreshold(): Promise<void> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const rows = await prisma.$queryRaw<Array<{ workerId: string; totalSubtotal: number }>>(Prisma.sql`
    SELECT b."workerId" AS "workerId", SUM(p."subtotal") AS "totalSubtotal"
    FROM "Payment" p
    JOIN "Booking" b ON b.id = p."bookingId"
    WHERE p.status = 'COMPLETED'
      AND p."capturedAt" >= ${twelveMonthsAgo}
      AND b."workerId" IS NOT NULL
    GROUP BY b."workerId"
    HAVING SUM(p."subtotal") >= ${VAT_REGISTRATION_THRESHOLD}
  `);

  if (rows.length === 0) return;

  const eligibleProfiles = await prisma.workerProfile.findMany({
    where: {
      userId: { in: rows.map((r) => r.workerId) },
      vatRegistered: false,
      vatThresholdFlaggedAt: null,
    },
    select: { id: true, userId: true },
  });

  if (eligibleProfiles.length === 0) return;

  const grossByWorker = new Map(rows.map((r) => [r.workerId, Number(r.totalSubtotal)]));

  for (const profile of eligibleProfiles) {
    const trailingGross = grossByWorker.get(profile.userId) ?? 0;

    await prisma.workerProfile.update({
      where: { id: profile.id },
      data: { vatThresholdFlaggedAt: new Date() },
    });

    await notifyUser({
      userId: profile.userId,
      type: 'VAT_THRESHOLD_CROSSED',
      title: 'You may need to register for VAT',
      message:
        `Your trailing 12-month gross receipts (₱${trailingGross.toLocaleString()}) have crossed BIR's ` +
        `₱${VAT_REGISTRATION_THRESHOLD.toLocaleString()} VAT-registration threshold. You may be legally ` +
        `required to register — see your tax settings to submit your VAT registration.`,
    });

    await writeAuditLog({
      action: 'VAT_THRESHOLD_CROSSED',
      category: 'SYSTEM_ERROR',
      level: 'WARN',
      message: `Worker ${profile.userId} crossed the BIR VAT threshold (₱${trailingGross.toFixed(2)} trailing 12mo gross, not VAT-registered)`,
      metadata: { workerId: profile.userId, trailingGross },
    });
  }

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isDeleted: false }, select: { id: true } });
  await Promise.all(
    eligibleProfiles.flatMap((profile) =>
      admins.map((admin) =>
        notifyUser({
          userId: admin.id,
          type: 'VAT_THRESHOLD_CROSSED',
          title: 'Worker crossed VAT threshold',
          message: `A non-VAT-registered worker's trailing 12-month gross receipts crossed ₱${VAT_REGISTRATION_THRESHOLD.toLocaleString()} — review their VAT registration status.`,
          relatedId: profile.userId,
        })
      )
    )
  );
}
