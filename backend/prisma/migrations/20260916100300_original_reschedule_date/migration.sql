-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "originalScheduledDate" TIMESTAMP(3),
ADD COLUMN     "originalTimeSlot" "TimeSlot";

-- Backfill: for a booking already mid-reschedule, previousScheduledDate/
-- previousTimeSlot is the best available approximation of the true
-- original (exact for a booking moved only once so far; for one already
-- moved twice, the true original is already unrecoverable — which is
-- exactly the bug this migration's new columns fix going forward).
UPDATE "Booking"
SET "originalScheduledDate" = "previousScheduledDate",
    "originalTimeSlot" = "previousTimeSlot"
WHERE "rescheduledAt" IS NOT NULL AND "originalScheduledDate" IS NULL;
