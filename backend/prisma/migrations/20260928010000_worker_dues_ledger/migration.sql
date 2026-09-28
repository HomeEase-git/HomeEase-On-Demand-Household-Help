-- AlterEnum
ALTER TYPE "DebtLedgerEntryType" ADD VALUE 'RECOVERY_REVERSED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "compensationPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "settlementReversedAt" TIMESTAMP(3);
