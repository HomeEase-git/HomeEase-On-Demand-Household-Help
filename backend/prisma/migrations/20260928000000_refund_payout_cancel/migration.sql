-- AlterEnum
ALTER TYPE "PayoutStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "xenditRefundId" TEXT,
ADD COLUMN     "xenditRefundStatus" TEXT;
