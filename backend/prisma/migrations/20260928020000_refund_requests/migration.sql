-- CreateEnum
CREATE TYPE "RefundRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'FAILED', 'REJECTED', 'REFUNDED_MANUALLY');

-- CreateEnum
CREATE TYPE "RefundRequestSource" AS ENUM ('BOOKING_CANCELLED', 'ADMIN_CANCEL', 'DISPUTE_RESOLUTION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REFUND_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_REJECTED';

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "disputeId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "source" "RefundRequestSource" NOT NULL,
    "requestedById" TEXT,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundRequest_status_idx" ON "RefundRequest"("status");

-- CreateIndex
CREATE INDEX "RefundRequest_paymentId_idx" ON "RefundRequest"("paymentId");

-- CreateIndex
CREATE INDEX "RefundRequest_bookingId_idx" ON "RefundRequest"("bookingId");

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

