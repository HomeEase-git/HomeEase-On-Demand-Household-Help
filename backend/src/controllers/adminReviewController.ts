import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatDisplayId } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const reviewInclude = {
  booking: true,
  client: { select: { id: true, fullName: true } },
  worker: { include: { user: { select: { id: true, fullName: true } } } },
} satisfies Prisma.ReviewInclude;

type ReviewRecord = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

function formatReview(record: ReviewRecord) {
  return {
    id: record.id,
    displayId: formatDisplayId(record.id),
    booking: record.booking ? formatDisplayId(record.booking.id) : '—',
    bookingId: record.booking?.id ?? null,
    client: record.client?.fullName ?? '—',
    clientId: record.client?.id ?? null,
    worker: record.worker?.user?.fullName ?? '—',
    workerId: record.worker?.user?.id ?? null,
    rating: record.rating.toFixed(1),
    comment: record.comment ?? '',
    photoUrls: record.photoUrls,
    flagged: record.flagged,
    flagReason: record.flagReason,
    status: record.status,
    createdAt: record.createdAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}

function buildReviewWhere(search: string, flagged?: string): Prisma.ReviewWhereInput {
  const where: Prisma.ReviewWhereInput = {};

  if (flagged === 'true') {
    where.flagged = true;
  } else if (flagged === 'false') {
    where.flagged = false;
  }

  if (search) {
    where.OR = [
      { booking: { id: { contains: search } } },
      { client: { fullName: { contains: search } } },
      { comment: { contains: search } },
    ];
  }

  return where;
}

export const listReviews = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const flagged = typeof req.query.flagged === 'string' ? req.query.flagged : undefined;

    const where = buildReviewWhere(search, flagged);

    const [total, records] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: reviewInclude,
      }),
    ]);

    return res.json({
      success: true,
      data: records.map(formatReview),
      meta: buildPaginationMeta(total, page, limit),
    });
  } catch (error) {
    console.error('List reviews error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const getReviewById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const record = await prisma.review.findUnique({
      where: { id },
      include: reviewInclude,
    });

    if (!record) {
      return res.status(404).json(errorResponse(404, 'Review not found'));
    }

    return res.json({ success: true, data: formatReview(record) });
  } catch (error) {
    console.error('Get review error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const updateReview = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { rating, comment, flagged, flagReason, status } = req.body as {
      rating?: number;
      comment?: string | null;
      flagged?: boolean;
      flagReason?: string | null;
      status?: 'VISIBLE' | 'HIDDEN' | 'WARNED';
    };

    const record = await prisma.review.findUnique({ where: { id } });
    if (!record) {
      return res.status(404).json(errorResponse(404, 'Review not found'));
    }

    if (status && !['VISIBLE', 'HIDDEN', 'WARNED'].includes(status)) {
      return res.status(400).json(errorResponse(400, 'status must be one of: VISIBLE, HIDDEN, WARNED'));
    }

    const updated = await prisma.review.update({
      where: { id },
      data: {
        rating: typeof rating === 'number' ? rating : record.rating,
        comment: comment === undefined ? record.comment : comment,
        flagged: typeof flagged === 'boolean' ? flagged : record.flagged,
        flagReason: flagReason === undefined ? record.flagReason : flagReason,
        status: status ?? record.status,
      },
      include: reviewInclude,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'REVIEW_UPDATED',
      category: 'ADMIN_ACTION',
      message: `Review ${formatDisplayId(id)} updated to status ${updated.status}`,
    });

    return res.json({ success: true, data: formatReview(updated) });
  } catch (error) {
    console.error('Update review error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
