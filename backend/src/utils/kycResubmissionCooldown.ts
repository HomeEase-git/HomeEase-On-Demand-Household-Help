import prisma from '@config/database';

const COOLDOWN_HOURS = 24;

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
