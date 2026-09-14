-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "atcCode" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "vatAmount" DOUBLE PRECISION,
ADD COLUMN     "vatApplicable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "vatApplicable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "vatDocumentUrl" TEXT,
ADD COLUMN     "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatRejectionReason" TEXT,
ADD COLUMN     "vatReviewedAt" TIMESTAMP(3),
ADD COLUMN     "vatReviewedById" TEXT,
ADD COLUMN     "vatSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "vatVerificationStatus" "KycDocumentStatus";

-- CreateTable
CREATE TABLE "VatCollectionSummary" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "workerName" TEXT NOT NULL,
    "totalVatCollected" DOUBLE PRECISION NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VatCollectionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VatCollectionSummary_workerId_idx" ON "VatCollectionSummary"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "VatCollectionSummary_workerId_periodStart_periodEnd_key" ON "VatCollectionSummary"("workerId", "periodStart", "periodEnd");
