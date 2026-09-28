import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import prisma from '@config/database';
import type { Prisma } from '@prisma/client';
import { decryptField } from '@utils/fieldEncryption';
import { supabase, TAX_CERTIFICATE_BUCKET } from '@config/supabase';
import { getAppSettings } from '@services/appSettingsService';
import { roundToCentavo } from '@utils/money';
import { manilaMonthKey, manilaMonthsIn, manilaDateKey, formatManilaPeriod, formatMonthKey } from '@utils/manilaTime';

const PLATFORM_LEGAL_NAME = process.env.PLATFORM_LEGAL_NAME || 'HomeEase';
const PLATFORM_TIN = process.env.PLATFORM_TIN || '';
const SIGNED_URL_TTL_SECONDS = 300;

export interface CertificateGenerationResult {
  generated: number;
  skippedNoTin: string[]; // User.ids of workers with no TIN on file
  // True when nothing was generated because AppSettings.atcCode isn't set —
  // a loud gap is safer than silently defaulting to a possibly-wrong code
  // (this is data, not a hardcoded constant, precisely so it can be
  // corrected without a redeploy — see AppSettings.atcCode's schema comment).
  blockedNoAtcCode: boolean;
}

export interface MonthlyWithholding {
  month: string; // "2026-07" — Manila calendar month
  incomePayments: number;
  taxWithheld: number;
}

/**
 * Generates a Form 2307 withholding-tax certificate for every worker with at
 * least one payment captured in [periodStart, periodEnd) — a calendar quarter
 * starting at midnight Manila time — with the per-month breakdown Form 2307
 * asks for (1st, 2nd and 3rd month of the quarter), uploads the PDF to
 * the private tax-certificates bucket, and upserts the TaxCertificate row
 * (idempotent per worker+period via the model's unique constraint — safe to
 * re-run for the same period, e.g. to pick up a worker who added their TIN
 * after the first run).
 *
 * IMPORTANT — see the TaxCertificate model comment in schema.prisma: the
 * generated PDF contains the legally required figures but is NOT guaranteed
 * to match BIR's exact official 2307 template/format. Have an accountant
 * confirm it's acceptable for filing, or cross-check the figures against
 * BIR's own eBIRForms/Alphalist tool, before relying on this in production.
 */
export async function generateQuarterlyCertificates(
  periodStart: Date,
  periodEnd: Date,
  generatedByUserId: string
): Promise<CertificateGenerationResult> {
  const { atcCode } = await getAppSettings();
  if (!atcCode) {
    return { generated: 0, skippedNoTin: [], blockedNoAtcCode: true };
  }

  const payments = await prisma.payment.findMany({
    where: {
      status: 'COMPLETED',
      capturedAt: { gte: periodStart, lt: periodEnd },
    },
    select: {
      subtotal: true,
      commissionAmount: true,
      withholdingTaxAmount: true,
      capturedAt: true,
      booking: { select: { workerId: true } },
    },
  });

  // Every month of the period, zeros included, so the certificate always
  // shows all three columns of the quarter.
  const months = manilaMonthsIn(periodStart, periodEnd);
  const byWorker = new Map<string, Map<string, { income: number; tax: number }>>();
  for (const payment of payments) {
    const workerId = payment.booking.workerId;
    if (!workerId || !payment.capturedAt) continue;
    const perMonth = byWorker.get(workerId) ?? new Map(months.map((m) => [m, { income: 0, tax: 0 }]));
    const bucket = perMonth.get(manilaMonthKey(payment.capturedAt));
    if (!bucket) continue;
    bucket.income += payment.subtotal - payment.commissionAmount;
    bucket.tax += payment.withholdingTaxAmount;
    byWorker.set(workerId, perMonth);
  }

  const result: CertificateGenerationResult = { generated: 0, skippedNoTin: [], blockedNoAtcCode: false };

  for (const [workerId, perMonth] of byWorker) {
    const monthlyBreakdown: MonthlyWithholding[] = months.map((month) => ({
      month,
      incomePayments: roundToCentavo(perMonth.get(month)?.income ?? 0),
      taxWithheld: roundToCentavo(perMonth.get(month)?.tax ?? 0),
    }));
    const agg = {
      income: roundToCentavo(monthlyBreakdown.reduce((sum, m) => sum + m.incomePayments, 0)),
      tax: roundToCentavo(monthlyBreakdown.reduce((sum, m) => sum + m.taxWithheld, 0)),
    };

    const profile = await prisma.workerProfile.findUnique({
      where: { userId: workerId },
      select: { tin: true, user: { select: { fullName: true } } },
    });

    if (!profile?.tin) {
      result.skippedNoTin.push(workerId);
      continue;
    }

    const pdfBuffer = await renderCertificatePdf({
      workerName: profile.user.fullName,
      workerTin: decryptField(profile.tin),
      periodStart,
      periodEnd,
      totalIncomePayments: agg.income,
      totalTaxWithheld: agg.tax,
      monthlyBreakdown,
      atcCode,
    });

    // Manila calendar dates, so the file name matches the quarter it covers.
    const pdfPath = `${workerId}/${manilaDateKey(periodStart)}_${manilaDateKey(periodEnd)}_${randomUUID()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from(TAX_CERTIFICATE_BUCKET)
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf' });

    if (uploadError) {
      console.error(`Failed to upload tax certificate for worker ${workerId}:`, uploadError);
      continue;
    }

    await prisma.taxCertificate.upsert({
      where: { workerId_periodStart_periodEnd: { workerId, periodStart, periodEnd } },
      update: {
        workerName: profile.user.fullName,
        workerTin: profile.tin,
        totalIncomePayments: agg.income,
        totalTaxWithheld: agg.tax,
        monthlyBreakdown: monthlyBreakdown as unknown as Prisma.InputJsonValue,
        pdfPath,
        status: 'ISSUED',
        issuedAt: new Date(),
        generatedBy: generatedByUserId,
      },
      create: {
        workerId,
        periodStart,
        periodEnd,
        workerName: profile.user.fullName,
        workerTin: profile.tin,
        totalIncomePayments: agg.income,
        totalTaxWithheld: agg.tax,
        monthlyBreakdown: monthlyBreakdown as unknown as Prisma.InputJsonValue,
        pdfPath,
        status: 'ISSUED',
        issuedAt: new Date(),
        generatedBy: generatedByUserId,
      },
    });

    result.generated++;
  }

  return result;
}

function renderCertificatePdf(data: {
  workerName: string;
  workerTin: string;
  periodStart: Date;
  periodEnd: Date;
  totalIncomePayments: number;
  totalTaxWithheld: number;
  monthlyBreakdown: MonthlyWithholding[];
  atcCode: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fmtPeso = (n: number) =>
      `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    doc.fontSize(16).text('Certificate of Creditable Tax Withheld at Source', { align: 'center' });
    doc.fontSize(10).text('(supporting data for BIR Form 2307 — see note below)', { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(11);
    doc.text(`Withholding Agent: ${PLATFORM_LEGAL_NAME}`);
    doc.text(`Withholding Agent TIN: ${PLATFORM_TIN || 'NOT CONFIGURED'}`);
    doc.moveDown();
    doc.text(`Payee: ${data.workerName}`);
    doc.text(`Payee TIN: ${data.workerTin}`);
    doc.moveDown();
    // Dates in Manila time; the stored end is exclusive, so Q3 reads
    // "July 1 to September 30".
    doc.text(`Period Covered: ${formatManilaPeriod(data.periodStart, data.periodEnd)}`);
    doc.text(`ATC Code: ${data.atcCode}`);
    doc.moveDown();

    // Form 2307 Part II lays income out by month of the quarter.
    const ordinals = ['1st', '2nd', '3rd'];
    const col = { label: 50, income: 270, tax: 420 };
    const header = doc.y;
    doc.font('Helvetica-Bold');
    doc.text('Month', col.label, header);
    doc.text('Income Payments', col.income, header);
    doc.text('Tax Withheld', col.tax, header);
    doc.font('Helvetica');
    data.monthlyBreakdown.forEach((m, i) => {
      const y = doc.y + 4;
      const label = `${ordinals[i] ?? `${i + 1}th`} month — ${formatMonthKey(m.month)}`;
      doc.text(label, col.label, y);
      doc.text(fmtPeso(m.incomePayments), col.income, y);
      doc.text(fmtPeso(m.taxWithheld), col.tax, y);
    });
    const totalY = doc.y + 6;
    doc.font('Helvetica-Bold');
    doc.text('Total for the quarter', col.label, totalY);
    doc.text(fmtPeso(data.totalIncomePayments), col.income, totalY);
    doc.text(fmtPeso(data.totalTaxWithheld), col.tax, totalY);
    doc.font('Helvetica');
    doc.x = 50;
    doc.moveDown(2);

    doc
      .fontSize(8)
      .fillColor('gray')
      .text(
        "This document summarizes income payments and tax withheld for the period above, as recorded by the platform, to support the payee's own tax filing. It has not been verified as identical to BIR's official Form 2307 template — consult an accountant before relying on it for formal filing.",
        { align: 'left' }
      );

    doc.end();
  });
}

/** Mints a short-lived signed URL for a stored certificate PDF (the bucket is private). */
export async function getCertificateDownloadUrl(pdfPath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(TAX_CERTIFICATE_BUCKET)
    .createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    console.error('Failed to create signed URL for tax certificate:', error);
    return null;
  }

  return data.signedUrl;
}
