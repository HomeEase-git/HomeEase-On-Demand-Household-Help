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

class AlreadyWarnedError extends Error {}

/**
 * POST /api/admin/reviews/:id/warn  { reason, target }
 * Warns whoever wrote `target`: 'REVIEW' (the client's comment) or
 * 'RESPONSE' (the worker's reply). The admin UI sends the part it showed,
 * not whatever Review.flagTarget says now, since a newer report can change
 * that while the modal is open. Strike 1 is a warning, 2 a final warning,
 * 3 suspends the account. Each part can earn one strike only.
 */
export const warnReviewAuthor = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 10) {
      return res.status(400).json(errorResponse(400, 'Give the user a reason (at least 10 characters)'));
    }
    const target = req.body?.target;
    if (target !== 'REVIEW' && target !== 'RESPONSE') {
      return res.status(400).json(errorResponse(400, 'target must be REVIEW or RESPONSE'));
    }
    const isResponse = target === 'RESPONSE';

    const review = await prisma.review.findUnique({ where: { id }, include: reviewInclude });
    if (!review) {
      return res.status(404).json(errorResponse(404, 'Review not found'));
    }
    if (isResponse && !review.workerResponse) {
      return res.status(409).json(errorResponse(409, 'This review has no reply to warn about'));
    }
    const targetUserId = isResponse ? review.worker.user.id : review.clientId;
    const what = isResponse ? 'your reply to a review' : 'your review';

    // Claiming the part, adding the strike and suspending all commit together:
    // a repeated or retried request gets a 409 instead of a second strike, and
    // a 3rd strike can't be saved without the suspension.
    let strike: number;
    let fullName: string;
    try {
      ({ strike, fullName } = await prisma.$transaction(async (tx) => {
        const claimed = await tx.review.updateMany({
          // A warned review drops off the worker's public profile (and
          // rating); a warned reply stays, already profanity-masked.
          where: isResponse ? { id, responseWarnedAt: null } : { id, status: { not: 'WARNED' } },
          data: isResponse ? { responseWarnedAt: new Date() } : { status: 'WARNED' },
        });
        if (claimed.count === 0) throw new AlreadyWarnedError();
        // Close the report only if it is about this part; a pending report
        // on the other part stays in the queue.
        await tx.review.updateMany({
          where: { id, OR: [{ flagTarget: target }, { flagged: false }] },
          data: { flagged: false, flagReason: reason },
        });
        const user = await tx.user.update({
          where: { id: targetUserId },
          data: { warningCount: { increment: 1 } },
          select: { warningCount: true, fullName: true },
        });
        if (user.warningCount >= MAX_WARNINGS) {
          await tx.user.update({ where: { id: targetUserId }, data: { status: 'SUSPENDED' } });
        }
        return { strike: user.warningCount, fullName: user.fullName };
      }));
    } catch (error) {
      if (error instanceof AlreadyWarnedError) {
        return res.status(409).json(errorResponse(409, `This user was already warned for ${what.replace('your ', 'their ')}`));
      }
      throw error;
    }
    const suspend = strike >= MAX_WARNINGS;

    if (!isResponse) await recomputeWorkerRating(review.workerId);
    if (suspend) {
      // Same immediate-effect logout as adminUserController.setUserStatus.
      await revokeUserSessions(targetUserId, JWT_EXPIRY);
      await revokeAllRefreshTokens(targetUserId);
    }

    try {
      await notifyUser({
        userId: targetUserId,
        type: suspend ? 'ACCOUNT_AUTO_SUSPENDED' : 'ACCOUNT_WARNING',
        title: suspend ? 'Account suspended' : strike === MAX_WARNINGS - 1 ? 'Final warning' : 'Warning',
        message: suspend
          ? `${what[0].toUpperCase()}${what.slice(1)} broke the community rules: ${reason}. This is warning ${strike} of ${MAX_WARNINGS}, so your account is suspended. Contact support to appeal.`
          : `${what[0].toUpperCase()}${what.slice(1)} broke the community rules: ${reason}. This is warning ${strike} of ${MAX_WARNINGS}. At ${MAX_WARNINGS} warnings your account is suspended.`,
        relatedId: review.bookingId,
      });
    } catch (error) {
      // The strike is already saved; a lost notification must not fail it.
      console.error('Warn review author: notification failed:', error);
    }

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: suspend ? 'USER_SUSPENDED_FOR_WARNINGS' : 'USER_WARNED',
      category: 'ADMIN_ACTION',
      message: `${fullName} warned (${strike}/${MAX_WARNINGS}) for ${what.replace('your ', 'their ')} on review ${formatDisplayId(id)}: ${reason}${suspend ? ' — suspended' : ''}`,
    });

    const updated = await prisma.review.findUniqueOrThrow({ where: { id }, include: reviewInclude });
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
