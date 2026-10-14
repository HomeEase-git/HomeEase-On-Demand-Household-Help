-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_WARNING';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "warningCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN "flagTarget" TEXT;
