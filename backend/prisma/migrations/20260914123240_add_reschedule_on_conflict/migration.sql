-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULE_CONFIRMED';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "previousScheduledDate" TIMESTAMP(3),
ADD COLUMN     "previousTimeSlot" "TimeSlot",
ADD COLUMN     "rescheduleAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "rescheduledAt" TIMESTAMP(3),
ADD COLUMN     "rescheduledFromBookingId" TEXT;

-- AlterTable
ALTER TABLE "WorkerAvailability" ADD COLUMN     "blockedByBookingId" TEXT;
