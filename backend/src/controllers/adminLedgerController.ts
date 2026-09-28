import { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { manilaMonthKey } from '@utils/manilaTime';
import { openLedger, LedgerAlreadyOpenError } from '@services/ledgerOpeningService';
import { syncXenditFees } from '@services/ledgerFeeSyncService';
import { buildReconciliation, monthRange } from '@services/ledgerReconciliationService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const currentMonth = () => manilaMonthKey(new Date());

/** GET /api/admin/ledger/status */
export const getLedgerStatus = async (_req: Request, res: Response) => {
  try {
    const [state, transactions, signoffs] = await Promise.all([
      prisma.ledgerState.findUnique({ where: { id: 'singleton' } }),
      prisma.ledgerTransaction.count(),
      prisma.ledgerReconciliation.findMany({ orderBy: { month: 'desc' }, take: 24 }),
    ]);
    return res.json({
      success: true,
      data: {
        openedAt: state?.openedAt ?? null,
        xenditFeesSyncedTo: state?.xenditFeesSyncedTo ?? null,
        transactions,
        reconciledMonths: signoffs.map((s) => ({
          month: s.month,
          allChecksPassed: s.allChecksPassed,
          note: s.note,
          reconciledById: s.reconciledById,
          createdAt: s.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Ledger status error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to load the ledger status'));
  }
};

/** POST /api/admin/ledger/open — one-time: records opening balances and starts the ledger. */
export const openLedgerAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user?.userId as string;
    const result = await openLedger(adminId);
    await writeAuditLog({
      actorId: adminId,
      action: 'LEDGER_OPENED',
      category: 'ADMIN_ACTION',
      message: `Admin opened the ledger: Xendit ₱${(result.xenditCentavos / 100).toFixed(2)}, ${result.workersCarried} worker balance(s) carried in`,
      metadata: { ...result, openedAt: result.openedAt.toISOString() },
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof LedgerAlreadyOpenError) {
      return res.status(409).json(errorResponse(409, error.message));
    }
    console.error('Open ledger error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to open the ledger'));
  }
};

/** POST /api/admin/ledger/sync-fees — pull Xendit fees now (also runs hourly). */
export const syncFeesAdmin = async (_req: Request, res: Response) => {
  try {
    const result = await syncXenditFees();
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Sync Xendit fees error:', error);
    return res.status(502).json(errorResponse(502, `Couldn't sync Xendit fees: ${error instanceof Error ? error.message : 'unknown error'}`));
  }
};

/** GET /api/admin/ledger/reconciliation?month=YYYY-MM */
export const getReconciliation = async (req: Request, res: Response) => {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : currentMonth();
    if (!monthRange(month)) return res.status(400).json(errorResponse(400, 'month must be YYYY-MM'));
    const report = await buildReconciliation(month);
    const signoff = await prisma.ledgerReconciliation.findUnique({ where: { month } });
    return res.json({ success: true, data: { ...report, signoff } });
  } catch (error) {
    console.error('Reconciliation error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to build the reconciliation'));
  }
};

/**
 * POST /api/admin/ledger/reconciliation { month, note }
 * Signs a month off with a snapshot of the report. A note is always
 * required, and must explain any check that didn't pass.
 */
export const signOffReconciliation = async (req: AuthRequest, res: Response) => {
  try {
    const { month, note } = req.body as { month?: string; note?: string };
    if (!month || !monthRange(month)) return res.status(400).json(errorResponse(400, 'month must be YYYY-MM'));
    if (!note?.trim()) return res.status(400).json(errorResponse(400, 'A note is required'));
    if (month >= currentMonth()) {
      return res.status(400).json(errorResponse(400, 'Only a month that has ended can be signed off'));
    }

    const report = await buildReconciliation(month);
    if (!report.opened) return res.status(409).json(errorResponse(409, 'The ledger is not open yet'));

    const adminId = req.user?.userId as string;
    const figures = JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue;
    const record = await prisma.ledgerReconciliation.upsert({
      where: { month },
      update: { allChecksPassed: report.allChecksPassed, figures, note: note.trim(), reconciledById: adminId },
      create: { month, allChecksPassed: report.allChecksPassed, figures, note: note.trim(), reconciledById: adminId },
    });
    await writeAuditLog({
      actorId: adminId,
      action: 'LEDGER_MONTH_RECONCILED',
      category: 'ADMIN_ACTION',
      message: `Admin signed off ${month} (${report.allChecksPassed ? 'all checks passed' : 'with differences noted'}): ${note.trim()}`,
      metadata: { month, allChecksPassed: report.allChecksPassed },
    });
    return res.json({ success: true, data: record });
  } catch (error) {
    console.error('Reconciliation sign-off error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to sign off the month'));
  }
};

/** GET /api/admin/ledger/transactions?month=YYYY-MM — the journal for a month. */
export const listLedgerTransactions = async (req: Request, res: Response) => {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : currentMonth();
    const range = monthRange(month);
    if (!range) return res.status(400).json(errorResponse(400, 'month must be YYYY-MM'));
    const { page, limit, skip } = getPaginationParams(req.query);
    const where = { occurredAt: { gte: range.start, lt: range.end } };
    const [total, rows] = await Promise.all([
      prisma.ledgerTransaction.count({ where }),
      prisma.ledgerTransaction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip,
        take: limit,
        include: { lines: { orderBy: { amountCentavos: 'desc' } } },
      }),
    ]);
    return res.json({
      success: true,
      data: rows.map((t) => ({
        id: t.id,
        type: t.type,
        occurredAt: t.occurredAt,
        memo: t.memo,
        bookingId: t.bookingId,
        lines: t.lines.map((l) => ({ account: l.account, amountCentavos: l.amountCentavos, workerId: l.workerId, clientId: l.clientId })),
      })),
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('Ledger transactions error:', error);
    return res.status(500).json(errorResponse(500, 'Failed to load ledger transactions'));
  }
};
