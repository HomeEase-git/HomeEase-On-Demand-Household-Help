import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import prisma from '@config/database';
import { supabase, TAX_CERTIFICATE_BUCKET } from '@config/supabase';

const PLATFORM_LEGAL_NAME = process.env.PLATFORM_LEGAL_NAME || 'HomeEase';
const PLATFORM_TIN = process.env.PLATFORM_TIN || '';
const SIGNED_URL_TTL_SECONDS = 300;

export interface CertificateGenerationResult {
  generated: number;
  skippedNoTin: string[]; // User.ids of workers with no TIN on file
}

/**
 * Generates a Form 2307 withholding-tax certificate for every worker with at
 * least one payment captured in [periodStart, periodEnd), uploads the PDF to
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
  const payments = await prisma.payment.findMany({
    where: {
      status: 'COMPLETED',
      capturedAt: { gte: periodStart, lt: periodEnd },
    },
    select: {
      subtotal: true,
      commissionAmount: true,
      withholdingTaxAmount: true,
      booking: { select: { workerId: true } },
    },
  });

  const byWorker = new Map<string, { income: number; tax: number }>();
  for (const payment of payments) {
    const workerId = payment.booking.workerId;
    if (!workerId) continue;
    const agg = byWorker.get(workerId) ?? { income: 0, tax: 0 };
    agg.income += payment.subtotal - payment.commissionAmount;
    agg.tax += payment.withholdingTaxAmount;
    byWorker.set(workerId, agg);
  }

  const result: CertificateGenerationResult = { generated: 0, skippedNoTin: [] };

  for (const [workerId, agg] of byWorker) {
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
      workerTin: profile.tin,
      periodStart,
      periodEnd,
      totalIncomePayments: agg.income,
      totalTaxWithheld: agg.tax,
    });

    const pdfPath = `${workerId}/${periodStart.toISOString().slice(0, 10)}_${periodEnd
      .toISOString()
      .slice(0, 10)}_${randomUUID()}.pdf`;

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
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fmtDate = (d: Date) =>
      d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
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
    doc.text(`Period Covered: ${fmtDate(data.periodStart)} to ${fmtDate(data.periodEnd)}`);
    doc.text('ATC Code: WC158 (income payments to certain contractors)');
    doc.moveDown();
    doc.text(`Total Income Payments: ${fmtPeso(data.totalIncomePayments)}`);
    doc.text(`Total Tax Withheld: ${fmtPeso(data.totalTaxWithheld)}`);
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
