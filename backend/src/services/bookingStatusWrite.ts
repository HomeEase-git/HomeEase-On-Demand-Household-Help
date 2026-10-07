import type { BookingStatus, Prisma } from '@prisma/client';
import prisma from '@config/database';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Thrown when a booking's status changed between the request reading it and
 * writing the transition — e.g. the pending-expiry job cancelled it while the
 * worker was accepting. Controllers answer 409; workers treat it as a no-op.
 */
export class BookingStatusConflictError extends Error {
  constructor(
    readonly bookingId: string,
    readonly expected: readonly BookingStatus[]
  ) {
    super(`Booking ${bookingId} is no longer ${expected.join('/')}`);
    this.name = 'BookingStatusConflictError';
  }
}

export function isBookingStatusConflict(error: unknown): error is BookingStatusConflictError {
  return error instanceof BookingStatusConflictError;
}

/**
 * Compare-and-set booking write: applies `data` only while the row is still
 * in one of the `expected` statuses, in a single UPDATE … WHERE status IN (…).
 * A plain update({ where: { id } }) after an earlier status read lets two
 * racing transitions both succeed (last writer wins); this makes the loser
 * fail with BookingStatusConflictError instead. Inside a $transaction the
 * throw also rolls back the transaction's other writes.
 *
 * `data` can't hold nested relation writes (updateMany limitation) — do those
 * separately after this succeeds. `alsoWhere` adds further conditions the row
 * must still meet (e.g. the quote revision the client actually looked at).
 */
export async function updateBookingIfStatus(
  db: Db,
  id: string,
  expected: BookingStatus | readonly BookingStatus[],
  data: Prisma.BookingUpdateManyMutationInput,
  alsoWhere: Prisma.BookingWhereInput = {}
): Promise<void> {
  const from: BookingStatus[] = Array.isArray(expected) ? [...expected] : [expected as BookingStatus];
  const { count } = await db.booking.updateMany({ where: { ...alsoWhere, id, status: { in: from } }, data });
  if (count === 0) throw new BookingStatusConflictError(id, from);
}
