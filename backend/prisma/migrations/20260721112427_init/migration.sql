/*
  Warnings:

  - You are about to drop the column `reviewedBy` on the `KycDocument` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `KycDocument` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[workerId,scheduledDate,scheduledTime]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `ClientProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `verificationRequestId` to the `KycDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `WorkerProfile` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KycDocumentType" ADD VALUE 'NBI_CLEARANCE';
ALTER TYPE "KycDocumentType" ADD VALUE 'BARANGAY_CLEARANCE';
ALTER TYPE "KycDocumentType" ADD VALUE 'POLICE_CLEARANCE';
ALTER TYPE "KycDocumentType" ADD VALUE 'CEDULA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'VERIFICATION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'VERIFICATION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'VERIFICATION_REJECTED';

-- DropForeignKey
ALTER TABLE "KycDocument" DROP CONSTRAINT "KycDocument_userId_fkey";

-- DropIndex
DROP INDEX "KycDocument_userId_documentType_idx";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "scheduledTime" TEXT,
ALTER COLUMN "workerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "KycDocument" DROP COLUMN "reviewedBy",
DROP COLUMN "userId",
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "originalName" TEXT,
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "verificationRequestId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "KYCStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "adminOverrideReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "aiStatus" TEXT,
    "aiSummary" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "aiError" TEXT,
    "aiReviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationRequest_status_idx" ON "VerificationRequest"("status");

-- CreateIndex
CREATE INDEX "VerificationRequest_userId_idx" ON "VerificationRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_workerId_scheduledDate_scheduledTime_key" ON "Booking"("workerId", "scheduledDate", "scheduledTime");

-- CreateIndex
CREATE INDEX "KycDocument_verificationRequestId_documentType_idx" ON "KycDocument"("verificationRequestId", "documentType");

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
