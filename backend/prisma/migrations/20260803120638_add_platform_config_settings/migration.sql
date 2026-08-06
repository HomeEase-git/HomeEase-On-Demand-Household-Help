-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
ADD COLUMN     "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "maxSlotsPerDay" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "pendingExpiryMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "withholdingTaxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05;

-- NOTE: the "worker_slot_unique" -> "Booking_workerId_scheduledDate_timeSlot_key"
-- rename that originally lived here was moved to the end of migration
-- 20260803140000_add_booking_flow_matching_arrival_pricing, since that's the
-- migration that actually creates the "worker_slot_unique" index — having
-- the rename run here (before the index exists) broke every from-scratch
-- replay (fresh shadow DB, CI, a new environment) with "relation
-- worker_slot_unique does not exist", even though it happened to succeed
-- against the already-partially-migrated dev DB it was first written
-- against. Fixed 2026-08-04.
