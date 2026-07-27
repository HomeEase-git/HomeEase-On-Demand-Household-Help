-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'WARNED');

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'VISIBLE';

-- CreateIndex
CREATE INDEX "Review_flagged_idx" ON "Review"("flagged");
