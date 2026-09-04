/**
 * Single source of truth for the "valid values" lists used to validate raw
 * request bodies against Prisma's booking-related enums.
 *
 * These are derived from the Prisma-generated enum objects (Object.values),
 * not hand-typed — so adding/removing a value in schema.prisma automatically
 * updates every validator that imports from here, instead of requiring a
 * matching manual edit in each of the several places (validation.ts,
 * bookingController.ts, workerController.ts) that used to hand-roll their
 * own copy of the same list and could silently drift from each other.
 */
import { TimeSlot, ConditionType, UrgencyLevel, RoomType, PaymentMethodType } from '@prisma/client';

export const VALID_TIME_SLOTS: TimeSlot[] = Object.values(TimeSlot);
export const VALID_CONDITIONS: ConditionType[] = Object.values(ConditionType);
export const VALID_URGENCY_LEVELS: UrgencyLevel[] = Object.values(UrgencyLevel);
export const VALID_ROOM_TYPES: RoomType[] = Object.values(RoomType);
export const VALID_PAYMENT_METHOD_TYPES: PaymentMethodType[] = Object.values(PaymentMethodType);
