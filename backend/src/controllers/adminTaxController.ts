import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatPeso } from '@utils/formatters';
import { maskTin } from '@utils/taxId';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { writeAuditLog } from '@utils/auditLog';
import { generateQuarterlyCertificates, getCertificateDownloadUrl } from '@services/taxCertificateService';
import { summarizeRemittancePeriod, markPeriodRemitted } from '@services/taxRemittanceService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

function parsePeriod(query: Request['query']) {
  const periodStart = new Date(String(query.periodStart ?? ''));
  const periodEnd = new Date(String(query.periodEnd ?? ''));
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
    return null;
  }
  return { periodStart, periodEnd };
}

/**
 * POST /api/admin/tax/certificates/generate
 * Generates (or re-generates, for workers who added a TIN since the last
 * run) Form 2307 certificates for every worker with captured payments in
 * the given period. See taxCertificateService for the generation logic and
 * its compliance caveat.
 */
export const generateCertificates = async (req: AuthRequest, res: Response) => {
  try {
    const period = parsePeriod({ periodStart: req.body.periodStart, periodEnd: req.body.periodEnd });
    if (!period) {
      return res.status(400).json(errorResponse(400, 'periodStart and periodEnd must be valid dates with periodStart before periodEnd'));
    }

    const adminId = req.user?.userId as string;
    const result = await generateQuarterlyCertificates(period.periodStart, period.periodEnd, adminId);

    await writeAuditLog({
      actorId: adminId,
      action: 'TAX_CERTIFICATES_GENERATED',
      category: 'ADMIN_ACTION',
      message: `Admin generated ${result.generated} tax certificate(s) for ${period.periodStart.toISOString().slice(0, 10)}–${period.periodEnd.toISOString().slice(0, 10)}`,
      metadata: { ...period, generated: result.generated, skippedNoTin: result.skippedNoTin },
    });

    return res.status(201).json({
      success: true,
      message: `Generated ${result.generated} certificate(s). ${result.skippedNoTin.length} worker(s) skipped — no TIN on file.`,
      data: result,
    });
  } catch (error) {
    console.error('Generate tax certificates error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to generate tax certificates'));
  }
};

/**
 * GET /api/admin/tax/certificates
 * Paginated list of generated certificates, newest period first.
 */
export const listCertificates = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;

    const where = status ? { status: status as 'DRAFT' | 'ISSUED' } : {};

    const [records, total] = await Promise.all([
      prisma.taxCertificate.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }, { workerName: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.taxCertificate.count({ where }),
    ]);

    return res.json({
      success: true,
      data: records.map((r) => ({
        id: r.id,
        workerId: r.workerId,
        workerName: r.workerName,
        maskedTin: maskTin(r.workerTin),
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        totalIncomePayments: r.totalIncomePayments,
        totalIncomePaymentsFormatted: formatPeso(r.totalIncomePayments),
        totalTaxWithheld: r.totalTaxWithheld,
        totalTaxWithheldFormatted: formatPeso(r.totalTaxWithheld),
        status: r.status,
        issuedAt: r.issuedAt,
      })),
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('List tax certificates error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch tax certificates'));
  }
};

/**
 * GET /api/admin/tax/certificates/:id/download
 * Mints a short-lived signed URL to the certificate PDF (private bucket).
 */
export const downloadCertificate = async (req: Request, res: Response) => {
  try {
    const record = await prisma.taxCertificate.findUnique({ where: { id: req.params.id as string } });
    if (!record) {
      return res.status(404).json(errorResponse(404, 'Certificate not found'));
    }

    const url = await getCertificateDownloadUrl(record.pdfPath);
    if (!url) {
      return res.status(502).json(errorResponse(502, 'Failed to generate a download link'));
    }

    return res.json({ success: true, data: { downloadUrl: url } });
  } catch (error) {
    console.error('Download tax certificate error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to generate a download link'));
  }
};

/**
 * GET /api/admin/tax/remittance?periods=2026-01-01:2026-04-01,2026-04-01:2026-07-01
 * Summarizes withholding tax due (and any recorded remittance) for each
 * requested period. Periods are computed on demand, not stored, until an
 * admin marks one remitted.
 */
export const listRemittancePeriods = async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.periods === 'string' ? req.query.periods : '';
    const periods = raw
      .split(',')
      .map((chunk) => chunk.split(':'))
      .filter((pair) => pair.length === 2)
      .map(([start, end]) => ({ periodStart: new Date(start as string), periodEnd: new Date(end as string) }))
      .filter((p) => !Number.isNaN(p.periodStart.getTime()) && !Number.isNaN(p.periodEnd.getTime()));

    if (periods.length === 0) {
      return res.status(400).json(errorResponse(400, 'periods must be a comma-separated list of start:end date pairs'));
    }

    const summaries = await Promise.all(
      periods.map((p) => summarizeRemittancePeriod(p.periodStart, p.periodEnd))
    );

    return res.json({
      success: true,
      data: summaries.map((s) => ({
        ...s,
        totalTaxWithheldFormatted: formatPeso(s.totalTaxWithheld),
      })),
    });
  } catch (error) {
    console.error('List remittance periods error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to fetch remittance summary'));
  }
};

/**
 * POST /api/admin/tax/remittance/mark-remitted
 * Records that a period's withheld tax was actually filed/paid to BIR
 * outside the app. See taxRemittanceService — this is bookkeeping only, not
 * e-filing automation.
 */
export const markRemitted = async (req: AuthRequest, res: Response) => {
  try {
    const period = parsePeriod({ periodStart: req.body.periodStart, periodEnd: req.body.periodEnd });
    const { referenceNumber, notes } = req.body as { referenceNumber?: string; notes?: string };

    if (!period) {
      return res.status(400).json(errorResponse(400, 'periodStart and periodEnd must be valid dates with periodStart before periodEnd'));
    }
    if (!referenceNumber || typeof referenceNumber !== 'string' || !referenceNumber.trim()) {
      return res.status(400).json(errorResponse(400, 'referenceNumber (the BIR/bank OR number) is required'));
    }

    const adminId = req.user?.userId as string;
    const record = await markPeriodRemitted(
      period.periodStart,
      period.periodEnd,
      referenceNumber.trim(),
      adminId,
      notes
    );

    await writeAuditLog({
      actorId: adminId,
      action: 'TAX_REMITTANCE_MARKED',
      category: 'ADMIN_ACTION',
      message: `Admin marked ${period.periodStart.toISOString().slice(0, 10)}–${period.periodEnd.toISOString().slice(0, 10)} as remitted (ref ${referenceNumber.trim()})`,
      metadata: { ...period, referenceNumber: referenceNumber.trim(), totalTaxWithheld: record.totalTaxWithheld },
    });

    return res.json({ success: true, message: 'Period marked as remitted', data: record });
  } catch (error) {
    console.error('Mark remitted error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to mark period as remitted'));
  }
};
