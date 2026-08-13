-- CreateEnum
CREATE TYPE "UrgencyLevel" AS ENUM ('STANDARD', 'URGENT', 'EMERGENCY');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "urgencyLevel" "UrgencyLevel" NOT NULL DEFAULT 'STANDARD';
