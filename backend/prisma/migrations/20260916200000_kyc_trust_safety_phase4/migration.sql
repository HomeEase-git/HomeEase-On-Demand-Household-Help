-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'KYC_REVERIFICATION_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_AUTO_SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_RESPONSE_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'CERTIFICATION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'CERTIFICATION_REJECTED';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "autoSuspendDisputeCountThreshold" INTEGER,
ADD COLUMN     "autoSuspendDisputeCountWindowDays" INTEGER,
ADD COLUMN     "autoSuspendRatingThreshold" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "selfDealingFlag" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Certification" ADD COLUMN     "serviceTypeId" TEXT;

-- AlterTable
ALTER TABLE "KycDocument" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "workerResponse" TEXT,
ADD COLUMN     "workerResponseAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ServiceType" ADD COLUMN     "requiresCertification" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Certification_serviceTypeId_idx" ON "Certification"("serviceTypeId");

-- CreateIndex
CREATE INDEX "KycDocument_expiresAt_idx" ON "KycDocument"("expiresAt");

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

