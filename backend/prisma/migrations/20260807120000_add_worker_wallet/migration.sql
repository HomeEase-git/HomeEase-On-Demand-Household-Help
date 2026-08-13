-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('TOPUP', 'ADMIN_FEE_DEDUCTION', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WalletTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "adminFeePerJob" DOUBLE PRECISION NOT NULL DEFAULT 20;

-- CreateTable
CREATE TABLE "WorkerWallet" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "status" "WalletTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION,
    "bookingId" TEXT,
    "paymongoCheckoutId" TEXT,
    "failureReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerWallet_workerProfileId_key" ON "WorkerWallet"("workerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_paymongoCheckoutId_key" ON "WalletTransaction"("paymongoCheckoutId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_idx" ON "WalletTransaction"("walletId");

-- CreateIndex
CREATE INDEX "WalletTransaction_bookingId_idx" ON "WalletTransaction"("bookingId");

-- AddForeignKey
ALTER TABLE "WorkerWallet" ADD CONSTRAINT "WorkerWallet_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WorkerWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
