-- CreateEnum
CREATE TYPE "DebtLedgerEntryType" AS ENUM ('COMMISSION_DEBIT', 'DEBT_RECOVERY', 'ADMIN_ADJUSTMENT', 'REVERSAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_ON_HOLD';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_HOLD_RELEASED';

-- DropForeignKey
ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_walletId_fkey";

-- DropForeignKey
ALTER TABLE "WorkerWallet" DROP CONSTRAINT "WorkerWallet_workerProfileId_fkey";

-- AlterTable
ALTER TABLE "AppSettings" DROP COLUMN "adminFeePerJob",
ADD COLUMN     "workerDebtHoldLimit" DOUBLE PRECISION NOT NULL DEFAULT 500;

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "commissionOwed" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "debtHoldAt" TIMESTAMP(3),
ADD COLUMN     "debtHoldNote" TEXT;

-- DropTable
DROP TABLE "WalletTransaction";

-- DropTable
DROP TABLE "WorkerWallet";

-- DropEnum
DROP TYPE "WalletTransactionStatus";

-- DropEnum
DROP TYPE "WalletTransactionType";

-- CreateTable
CREATE TABLE "DebtLedgerEntry" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "type" "DebtLedgerEntryType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "bookingId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DebtLedgerEntry_workerProfileId_idx" ON "DebtLedgerEntry"("workerProfileId");

-- CreateIndex
CREATE INDEX "DebtLedgerEntry_bookingId_idx" ON "DebtLedgerEntry"("bookingId");

-- CreateIndex
CREATE INDEX "WorkerProfile_debtHoldAt_idx" ON "WorkerProfile"("debtHoldAt");

-- AddForeignKey
ALTER TABLE "DebtLedgerEntry" ADD CONSTRAINT "DebtLedgerEntry_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

