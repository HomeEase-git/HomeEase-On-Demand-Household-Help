-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "beforePhotoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "progressPhotoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
