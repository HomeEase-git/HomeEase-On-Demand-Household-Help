-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_FAILED';

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "refundStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "refundFailureReason" TEXT;
