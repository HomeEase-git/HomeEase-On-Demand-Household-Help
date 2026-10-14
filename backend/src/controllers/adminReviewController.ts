import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { formatDisplayId } from '@utils/formatters';
import { buildPaginationMeta, getPaginationParams } from '@utils/pagination';
import { writeAuditLog } from '@utils/auditLog';
import { notifyUser } from '@utils/notify';
import { revokeUserSessions } from '@utils/tokenRevocation';
import { revokeAllRefreshTokens } from '@utils/otpService';
import { JWT_EXPIRY } from '@utils/jwt';
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
    flagTarget: record.flagTarget ?? 'REVIEW',
    status: record.status,
    workerResponse: record.workerResponse,
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

// Both the rating value and the VISIBLE/HIDDEN/WARNED status can change from
// here, and WorkerProfile.rating/totalReviews were previously only ever
// recomputed at review-submission time — hiding a fake 5-star review (or a
// rating edit) left the worker's public rating permanently wrong until their
// next real review happened to trigger a recompute.
async function recomputeWorkerRating(workerId: string) {
  const ratingStats = await prisma.review.aggregate({
    where: { workerId, status: 'VISIBLE' },
    _avg: { rating: true },
    _count: true,
  });
  await prisma.workerProfile.update({
    where: { id: workerId },
    data: {
      rating: Math.round((ratingStats._avg.rating ?? 0) * 10) / 10,
      totalReviews: ratingStats._count,
    },
  });
}

const MAX_WARNINGS = 3;

/**
 * POST /api/admin/reviews/:id/warn  { reason }
 * Warns whoever wrote the reported part (Review.flagTarget): the client for
 * the review, the worker for their reply. Strike 1 is a warning, 2 a final
 * warning, 3 suspends the account. The user is told why each time.
 */
export const warnReviewAuthor = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 10) {
      return res.status(400).json(errorResponse(400, 'Give the user a reason (at least 10 characters)'));
    }

    const review = await prisma.review.findUnique({ where: { id }, include: reviewInclude });
    if (!review) {
      return res.status(404).json(errorResponse(404, 'Review not found'));
    }
    const isResponse = review.flagTarget === 'RESPONSE';
    const targetUserId = isResponse ? review.worker.user.id : review.clientId;
    const what = isResponse ? 'your reply to a review' : 'your review';

    const user = await prisma.user.update({
      where: { id: targetUserId },
      data: { warningCount: { increment: 1 } },
      select: { warningCount: true, fullName: true },
    });
    const strike = user.warningCount;
    const suspend = strike >= MAX_WARNINGS;

    const updated = await prisma.review.update({
      where: { id },
      // A warned review drops off the worker's public profile (and rating);
      // a warned reply stays, already profanity-masked.
      data: { flagged: false, flagReason: reason, ...(isResponse ? {} : { status: 'WARNED' as const }) },
      include: reviewInclude,
    });
    if (!isResponse) await recomputeWorkerRating(updated.workerId);

    await notifyUser({
      userId: targetUserId,
      type: suspend ? 'ACCOUNT_AUTO_SUSPENDED' : 'ACCOUNT_WARNING',
      title: suspend ? 'Account suspended' : strike === MAX_WARNINGS - 1 ? 'Final warning' : 'Warning',
      message: suspend
        ? `${what[0].toUpperCase()}${what.slice(1)} broke the community rules: ${reason}. This is warning ${strike} of ${MAX_WARNINGS}, so your account is suspended. Contact support to appeal.`
        : `${what[0].toUpperCase()}${what.slice(1)} broke the community rules: ${reason}. This is warning ${strike} of ${MAX_WARNINGS}. At ${MAX_WARNINGS} warnings your account is suspended.`,
      relatedId: review.bookingId,
    });

    if (suspend) {
      // Same immediate-effect suspension as adminUserController.setUserStatus.
      await prisma.user.update({ where: { id: targetUserId }, data: { status: 'SUSPENDED' } });
      await revokeUserSessions(targetUserId, JWT_EXPIRY);
      await revokeAllRefreshTokens(targetUserId);
    }

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: suspend ? 'USER_SUSPENDED_FOR_WARNINGS' : 'USER_WARNED',
      category: 'ADMIN_ACTION',
      message: `${user.fullName} warned (${strike}/${MAX_WARNINGS}) for ${what.replace('your ', 'their ')} on review ${formatDisplayId(id)}: ${reason}${suspend ? ' — suspended' : ''}`,
    });

    return res.json({ success: true, data: { ...formatReview(updated), warningCount: strike, suspended: suspend } });
  } catch (error) {
    console.error('Warn review author error:', error);
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

    await recomputeWorkerRating(updated.workerId);

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
