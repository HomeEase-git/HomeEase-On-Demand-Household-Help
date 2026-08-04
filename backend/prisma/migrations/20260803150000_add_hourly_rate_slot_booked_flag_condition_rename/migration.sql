-- AlterEnum
-- Renamed to match the product-facing condition labels (TIDY/NORMAL/HEAVY).
-- RENAME VALUE preserves any rows already written with the old labels
-- instead of requiring a drop-and-backfill.
ALTER TYPE "ConditionType" RENAME VALUE 'LIGHT' TO 'TIDY';
ALTER TYPE "ConditionType" RENAME VALUE 'MODERATE' TO 'NORMAL';

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "hourlyRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "WorkerAvailability" ADD COLUMN     "isBooked" BOOLEAN NOT NULL DEFAULT false;
