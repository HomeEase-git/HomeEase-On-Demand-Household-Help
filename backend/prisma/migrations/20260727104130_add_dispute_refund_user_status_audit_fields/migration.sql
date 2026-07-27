-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "disputeResolvedAt" TIMESTAMP(3),
ADD COLUMN     "disputeResolvedById" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");
