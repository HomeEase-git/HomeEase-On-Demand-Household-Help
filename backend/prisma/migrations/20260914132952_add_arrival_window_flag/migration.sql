-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_ARRIVAL_FLAGGED';

-- AlterTable
ALTER TABLE "ArrivalVerification" ADD COLUMN     "isOutsideBookedWindow" BOOLEAN NOT NULL DEFAULT false;
