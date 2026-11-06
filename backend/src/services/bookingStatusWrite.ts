import type { BookingStatus, Prisma } from '@prisma/client';
import prisma from '@config/database';

type Db = Prisma.TransactionClient | typeof prisma;

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

export async function lockBooking(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
  return tx.booking.findUnique({ where: { id }, include: { addOns: true } });
}

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
