-- CreateEnum
CREATE TYPE "TimeSlot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('BEDROOM', 'BATHROOM', 'KITCHEN', 'LIVING_ROOM', 'DINING_ROOM', 'OFFICE', 'GARAGE', 'BALCONY', 'OTHER');

-- CreateEnum
CREATE TYPE "ConditionType" AS ENUM ('LIGHT', 'MODERATE', 'HEAVY');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "addOnsSnapshot" JSONB,
ADD COLUMN     "clientLat" DOUBLE PRECISION,
ADD COLUMN     "clientLng" DOUBLE PRECISION,
ADD COLUMN     "condition" "ConditionType",
ADD COLUMN     "declinedWorkerIds" TEXT[],
ADD COLUMN     "distanceMeters" DOUBLE PRECISION,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "isAutoMatched" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priorities" TEXT[],
ADD COLUMN     "rooms" "RoomType"[],
ADD COLUMN     "timeSlot" "TimeSlot",
ADD COLUMN     "workerArrivedAt" TIMESTAMP(3),
ADD COLUMN     "workerCompletedAt" TIMESTAMP(3),
ADD COLUMN     "workerLat" DOUBLE PRECISION,
ADD COLUMN     "workerLng" DOUBLE PRECISION,
ADD COLUMN     "workerStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "authorizationId" TEXT,
ADD COLUMN     "authorizedAmount" DOUBLE PRECISION,
ADD COLUMN     "authorizedAt" TIMESTAMP(3),
ADD COLUMN     "capturedAmount" DOUBLE PRECISION,
ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "clientSecret" TEXT,
ADD COLUMN     "paymentIntentId" TEXT;

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "acceptsHeavyCondition" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "acceptsPets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currentLat" DOUBLE PRECISION,
ADD COLUMN     "currentLng" DOUBLE PRECISION,
ADD COLUMN     "lastLocationUpdate" TIMESTAMP(3),
ADD COLUMN     "preferredRoomTypes" "RoomType"[];

-- DropIndex
-- Old constraint keyed on (workerId, scheduledDate, scheduledTime); superseded
-- by the slot-based constraint below. Also normalizes long-standing drift
-- between this default-generated index name and the "worker_slot_unique"
-- name already declared in schema.prisma.
DROP INDEX "Booking_workerId_scheduledDate_scheduledTime_key";

-- CreateTable
CREATE TABLE "ArrivalVerification" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "workerLat" DOUBLE PRECISION NOT NULL,
    "workerLng" DOUBLE PRECISION NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArrivalVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cancellation" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "cancelledBy" "Role" NOT NULL,
    "cancelledById" TEXT NOT NULL,
    "reason" TEXT,
    "feeCharged" DOUBLE PRECISION DEFAULT 0,
    "refundAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclinedWorker" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "reason" TEXT,
    "declinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclinedWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "refundAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingLog" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "basePrice" DOUBLE PRECISION NOT NULL,
    "conditionFee" DOUBLE PRECISION DEFAULT 0,
    "distanceFee" DOUBLE PRECISION DEFAULT 0,
    "addOnsTotal" DOUBLE PRECISION DEFAULT 0,
    "finalEstimate" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerAvailability" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "timeSlot" "TimeSlot" NOT NULL,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArrivalVerification_bookingId_key" ON "ArrivalVerification"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Cancellation_bookingId_key" ON "Cancellation"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "DeclinedWorker_bookingId_workerId_key" ON "DeclinedWorker"("bookingId", "workerId");

-- CreateIndex
CREATE INDEX "Dispute_bookingId_idx" ON "Dispute"("bookingId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "PricingLog_bookingId_idx" ON "PricingLog"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerAvailability_workerProfileId_date_timeSlot_key" ON "WorkerAvailability"("workerProfileId", "date", "timeSlot");

-- CreateIndex
CREATE INDEX "WorkerAvailability_workerProfileId_date_idx" ON "WorkerAvailability"("workerProfileId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "worker_slot_unique" ON "Booking"("workerId", "scheduledDate", "timeSlot");

-- RenameIndex
-- Moved here from 20260803120638_add_platform_config_settings — this is the
-- migration that actually creates "worker_slot_unique", so the rename must
-- follow it, not precede it (see note in that migration).
ALTER INDEX "worker_slot_unique" RENAME TO "Booking_workerId_scheduledDate_timeSlot_key";

-- AddForeignKey
ALTER TABLE "ArrivalVerification" ADD CONSTRAINT "ArrivalVerification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclinedWorker" ADD CONSTRAINT "DeclinedWorker_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingLog" ADD CONSTRAINT "PricingLog_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerAvailability" ADD CONSTRAINT "WorkerAvailability_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
