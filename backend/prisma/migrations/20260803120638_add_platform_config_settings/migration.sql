-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
ADD COLUMN     "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "maxSlotsPerDay" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "pendingExpiryMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "withholdingTaxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05;

-- RenameIndex
ALTER INDEX "worker_slot_unique" RENAME TO "Booking_workerId_scheduledDate_timeSlot_key";
