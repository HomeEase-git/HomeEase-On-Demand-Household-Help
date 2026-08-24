-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "declineCooldownUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "maxDeclinesBeforeCooldown" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "declineWindowHours" INTEGER NOT NULL DEFAULT 168,
ADD COLUMN     "declineCooldownHours" INTEGER NOT NULL DEFAULT 24;
