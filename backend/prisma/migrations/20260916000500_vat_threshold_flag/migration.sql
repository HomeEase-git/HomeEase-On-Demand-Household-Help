-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'VAT_THRESHOLD_CROSSED';

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "vatThresholdFlaggedAt" TIMESTAMP(3);
