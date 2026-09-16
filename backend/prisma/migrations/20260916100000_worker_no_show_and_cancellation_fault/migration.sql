-- CreateEnum
CREATE TYPE "WorkerCancellationReason" AS ENUM ('WORKER_FAULT', 'CLIENT_NO_SHOW', 'OTHER');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "workerNoShowFlaggedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Cancellation" ADD COLUMN     "workerCancellationReason" "WorkerCancellationReason",
ADD COLUMN     "penalizedWorkerId" TEXT;

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "noShowGraceHours" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "disputeEscalationHours" INTEGER NOT NULL DEFAULT 48;

-- Backfill: matchingService's late-cancel penalty query is switching from
-- (cancelledBy='WORKER' AND cancelledWithinHours < 24) to a direct
-- penalizedWorkerId lookup (see the schema comment on that column) — without
-- this, every worker's existing cancellation-penalty history would silently
-- reset to zero the moment this migration lands, changing live auto-match
-- rankings. Reproduces the exact old condition for existing rows only; new
-- rows are set by bookingController.cancelBooking going forward.
UPDATE "Cancellation"
SET "penalizedWorkerId" = "cancelledById"
WHERE "cancelledBy" = 'WORKER' AND "cancelledWithinHours" < 24;
