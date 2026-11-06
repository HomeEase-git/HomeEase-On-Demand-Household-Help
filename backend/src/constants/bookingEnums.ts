import { TimeSlot, ConditionType, RoomType, PaymentMethodType } from '@prisma/client';

export const VALID_TIME_SLOTS: TimeSlot[] = Object.values(TimeSlot);
export const VALID_CONDITIONS: ConditionType[] = Object.values(ConditionType);
export const VALID_ROOM_TYPES: RoomType[] = Object.values(RoomType);
export const VALID_PAYMENT_METHOD_TYPES: PaymentMethodType[] = Object.values(PaymentMethodType);
