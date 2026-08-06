-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "issuePhotoUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
