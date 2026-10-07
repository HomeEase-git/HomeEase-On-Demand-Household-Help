import prisma from '@config/database';

/** Everyone `userId` has blocked or been blocked by. */
export async function blockedUserIds(userId: string): Promise<string[]> {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return [...new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)))];
}

/** True when either user has blocked the other. */
export async function isBlockedPair(a: string, b: string): Promise<boolean> {
  const row = await prisma.userBlock.findFirst({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { id: true },
  });
  return !!row;
}
