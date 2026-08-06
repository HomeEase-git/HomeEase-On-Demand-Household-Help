import type { Prisma, TimeSlot } from '@prisma/client';
import prisma from '@config/database';

export const MAX_SLOTS_PER_DAY = 2;

/** Normalizes any Date/date-like value to UTC midnight, matching how slots are stored. */
export function toDayStart(date: Date | string): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

type DbClient = typeof prisma | Prisma.TransactionClient;

export function findSlot(db: DbClient, workerProfileId: string, date: Date, timeSlot: TimeSlot) {
  return db.workerAvailability.findUnique({
    where: {
      workerProfileId_date_timeSlot: {
        workerProfileId,
        date: toDayStart(date),
        timeSlot,
      },
    },
  });
}

/**
 * Marks a slot as booked, creating the row if the worker never explicitly
 * opened it (an accepted booking should still occupy the slot on the
 * calendar even if the worker manages availability loosely).
 */
export async function markSlotBooked(
  db: DbClient,
  workerProfileId: string,
  date: Date,
  timeSlot: TimeSlot
) {
  const day = toDayStart(date);
  return db.workerAvailability.upsert({
    where: { workerProfileId_date_timeSlot: { workerProfileId, date: day, timeSlot } },
    create: { workerProfileId, date: day, timeSlot, isBooked: true },
    update: { isBooked: true },
  });
}

/** Frees a slot once its booking is no longer active (completed/cancelled/rejected). */
export async function freeSlot(db: DbClient, workerProfileId: string, date: Date, timeSlot: TimeSlot) {
  const day = toDayStart(date);
  const existing = await db.workerAvailability.findUnique({
    where: { workerProfileId_date_timeSlot: { workerProfileId, date: day, timeSlot } },
  });
  if (!existing) return null;

  return db.workerAvailability.update({
    where: { id: existing.id },
    data: { isBooked: false },
  });
}
