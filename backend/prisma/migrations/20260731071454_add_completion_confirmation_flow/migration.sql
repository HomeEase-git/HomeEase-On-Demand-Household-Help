-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'PENDING_COMPLETION';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "completionPhotoUrl" TEXT;
