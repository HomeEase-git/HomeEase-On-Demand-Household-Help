-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "photoUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
