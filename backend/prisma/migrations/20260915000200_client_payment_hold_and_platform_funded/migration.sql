-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "outstandingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "paymentHoldAt" TIMESTAMP(3),
ADD COLUMN     "paymentHoldNote" TEXT;

-- CreateIndex
CREATE INDEX "ClientProfile_paymentHoldAt_idx" ON "ClientProfile"("paymentHoldAt");

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "platformFunded" BOOLEAN NOT NULL DEFAULT false;
