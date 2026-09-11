-- AlterTable
ALTER TABLE "UserAddress" ADD COLUMN     "barangay" TEXT,
ADD COLUMN     "geocodeAccuracy" DOUBLE PRECISION,
ADD COLUMN     "geocodedAt" TIMESTAMP(3),
ADD COLUMN     "houseNumber" TEXT,
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;
