-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('XENDIT_CASH', 'MANUAL_SETTLEMENTS', 'WORKER_BALANCE', 'CLIENT_RECEIVABLE', 'COMMISSION_REVENUE', 'PENALTY_REVENUE', 'WITHHOLDING_TAX_PAYABLE', 'XENDIT_FEES', 'PLATFORM_FUNDED_EXPENSE', 'REFUND_LOSS', 'ADJUSTMENTS', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "LedgerEventType" AS ENUM ('OPENING', 'PAYMENT_CAPTURED', 'CASH_JOB_SETTLED', 'PLATFORM_FUNDED', 'PAYOUT_SENT', 'REFUND_SENT', 'CASH_JOB_REFUNDED', 'MANUAL_REFUND', 'PENALTY', 'CANCELLATION_FEE', 'CLIENT_FEE_CLEARED', 'ADMIN_ADJUSTMENT', 'XENDIT_FEE', 'TAX_REMITTED');

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "type" "LedgerEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "bookingId" TEXT,
    "paymentId" TEXT,
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerLine" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "amountCentavos" INTEGER NOT NULL,
    "workerId" TEXT,
    "clientId" TEXT,

    CONSTRAINT "LedgerLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "openedAt" TIMESTAMP(3),
    "openedById" TEXT,
    "xenditFeesSyncedTo" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerReconciliation" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "allChecksPassed" BOOLEAN NOT NULL,
    "figures" JSONB NOT NULL,
    "note" TEXT NOT NULL,
    "reconciledById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerTransaction_occurredAt_idx" ON "LedgerTransaction"("occurredAt");

-- CreateIndex
CREATE INDEX "LedgerTransaction_type_idx" ON "LedgerTransaction"("type");

-- CreateIndex
CREATE INDEX "LedgerTransaction_bookingId_idx" ON "LedgerTransaction"("bookingId");

-- CreateIndex
CREATE INDEX "LedgerLine_transactionId_idx" ON "LedgerLine"("transactionId");

-- CreateIndex
CREATE INDEX "LedgerLine_account_idx" ON "LedgerLine"("account");

-- CreateIndex
CREATE INDEX "LedgerLine_workerId_idx" ON "LedgerLine"("workerId");

-- CreateIndex
CREATE INDEX "LedgerLine_clientId_idx" ON "LedgerLine"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerReconciliation_month_key" ON "LedgerReconciliation"("month");

-- AddForeignKey
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

