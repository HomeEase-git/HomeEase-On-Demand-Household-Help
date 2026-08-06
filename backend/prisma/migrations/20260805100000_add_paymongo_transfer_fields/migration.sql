-- AlterTable
ALTER TABLE "Payout" ADD COLUMN "paymongoTransferId" TEXT;
ALTER TABLE "Payout" ADD COLUMN "paymongoTransferStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payout_paymongoTransferId_key" ON "Payout"("paymongoTransferId");
