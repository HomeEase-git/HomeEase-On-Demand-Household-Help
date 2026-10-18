-- AlterEnum
ALTER TYPE "DebtLedgerEntryType" ADD VALUE 'DEBT_PAYMENT';
ALTER TYPE "LedgerEventType" ADD VALUE 'DEBT_PAYMENT';

-- CreateEnum
CREATE TYPE "DebtPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "DebtPayment" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "DebtPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "xenditInvoiceId" TEXT,
    "checkoutUrl" TEXT,
    "paidAmount" DOUBLE PRECISION,
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebtPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DebtPayment_xenditInvoiceId_key" ON "DebtPayment"("xenditInvoiceId");
CREATE INDEX "DebtPayment_workerProfileId_status_idx" ON "DebtPayment"("workerProfileId", "status");

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One open invoice per worker at a time (Prisma can't express a partial index).
CREATE UNIQUE INDEX "DebtPayment_one_pending_per_worker" ON "DebtPayment"("workerProfileId") WHERE "status" = 'PENDING';
