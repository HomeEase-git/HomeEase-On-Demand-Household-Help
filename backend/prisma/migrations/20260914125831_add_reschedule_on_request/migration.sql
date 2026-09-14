-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_REQUEST_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_REQUEST_DECLINED';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "requestedScheduledDate" TIMESTAMP(3),
ADD COLUMN     "requestedTimeSlot" "TimeSlot",
ADD COLUMN     "rescheduleRequestAccepted" BOOLEAN,
ADD COLUMN     "rescheduleRequestReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleRequestRespondedAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleRequestedAt" TIMESTAMP(3);
