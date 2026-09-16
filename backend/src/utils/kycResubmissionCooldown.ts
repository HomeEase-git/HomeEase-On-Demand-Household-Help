import prisma from '@config/database';

const COOLDOWN_HOURS = 24;

/**
 * A REJECTED verification could previously be resubmitted an unlimited
 * number of times back-to-back — no cost to spamming resubmissions instead
 * of actually fixing whatever got it rejected in the first place, and each
 * one re-queues a real AI review call. Blocks starting a brand-new request
 * (uploadVerificationDocuments / submitKYCDocument's "no open request"
 * branch) for COOLDOWN_HOURS after the most recent REJECTED one for this
 * user+type. Does not affect adding documents to an already-open
 * PENDING/SUBMITTED request — only the "start over after rejection" path.
 */
export async function checkResubmissionCooldown(
  userId: string,
  type: string
): Promise<{ allowed: true } | { allowed: false; retryAfter: Date }> {
  const lastRejected = await prisma.verificationRequest.findFirst({
    where: { userId, type, status: 'REJECTED' },
    orderBy: { reviewedAt: 'desc' },
    select: { reviewedAt: true },
  });

  if (!lastRejected?.reviewedAt) {
    return { allowed: true };
  }

  const retryAfter = new Date(lastRejected.reviewedAt.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000);
  if (retryAfter > new Date()) {
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}
