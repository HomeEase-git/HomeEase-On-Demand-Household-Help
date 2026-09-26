-- Workers no longer set prices; packages they propose need admin approval.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PACKAGE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'PACKAGE_REJECTED';

-- AlterTable: existing packages were never reviewed, so they start PENDING
-- and stay hidden from clients until an admin approves them.
ALTER TABLE "WorkerPackage" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "KycDocumentStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "WorkerPackage_status_idx" ON "WorkerPackage"("status");
