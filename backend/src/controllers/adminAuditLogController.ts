import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';

const CATEGORY_LABEL: Record<string, string> = {
  ADMIN_ACTION: 'Admin Actions',
  LOGIN: 'Login History',
  SYSTEM_ERROR: 'System Errors',
  STATUS_CHANGE: 'Status Changes',
};

const SOURCE_PREFIXES: [string, string][] = [
  ['USER_LOGIN', 'Auth'],
  ['DISPUTE_', 'Dispute'],
  ['BOOKING_', 'Booking'],
  ['VERIFICATION_', 'Verification'],
  ['REVIEW_', 'Review'],
  ['PRICING_RULE_', 'Pricing'],
  ['PAYMENT_', 'Payment'],
  ['XENDIT_', 'Payment'],
  ['USER_STATUS_', 'User'],
  ['SETTINGS_', 'Settings'],
];

function deriveSource(action: string): string {
  const match = SOURCE_PREFIXES.find(([prefix]) => action.startsWith(prefix));
  return match ? match[1] : 'System';
}

function formatAuditLog(record: {
  id: string;
  action: string;
  category: string;
  level: string;
  message: string;
  createdAt: Date;
}) {
  return {
    id: record.id,
    time: record.createdAt.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }),
    level: record.level,
    category: CATEGORY_LABEL[record.category] ?? record.category,
    source: deriveSource(record.action),
    message: record.message,
  };
}

function buildAuditLogWhere(search: string, category: string): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (category && category !== 'All' && category !== 'all') {
    const categoryValue = Object.entries(CATEGORY_LABEL).find(([, label]) => label === category)?.[0];
    where.category = categoryValue ?? category;
  }

  if (search) {
    where.OR = [
      { message: { contains: search } },
      { actorName: { contains: search } },
      { action: { contains: search } },
    ];
  }

  return where;
}

export const listAuditLogs = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category : 'all';

    const where = buildAuditLogWhere(search, category);

    const [total, records] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.json({
      success: true,
      data: records.map(formatAuditLog),
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('List audit logs error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
