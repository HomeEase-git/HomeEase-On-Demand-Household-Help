-- CreateEnum
CREATE TYPE "WorkerServiceCategoryStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "NotificationType" ADD VALUE 'SERVICE_CATEGORY_VERIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'SERVICE_CATEGORY_REJECTED';

-- CreateTable
CREATE TABLE "WorkerServiceCategory" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "status" "WorkerServiceCategoryStatus" NOT NULL DEFAULT 'VERIFIED',
    "gatingCertificationId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerTaskSelection" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "serviceTaskId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerTaskSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerServiceCategory_serviceTypeId_status_idx" ON "WorkerServiceCategory"("serviceTypeId", "status");

-- CreateIndex
CREATE INDEX "WorkerServiceCategory_gatingCertificationId_idx" ON "WorkerServiceCategory"("gatingCertificationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerServiceCategory_workerProfileId_serviceTypeId_key" ON "WorkerServiceCategory"("workerProfileId", "serviceTypeId");

-- CreateIndex
CREATE INDEX "WorkerTaskSelection_serviceTaskId_idx" ON "WorkerTaskSelection"("serviceTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerTaskSelection_workerProfileId_serviceTaskId_key" ON "WorkerTaskSelection"("workerProfileId", "serviceTaskId");

-- AddForeignKey
ALTER TABLE "WorkerServiceCategory" ADD CONSTRAINT "WorkerServiceCategory_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerServiceCategory" ADD CONSTRAINT "WorkerServiceCategory_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerServiceCategory" ADD CONSTRAINT "WorkerServiceCategory_gatingCertificationId_fkey" FOREIGN KEY ("gatingCertificationId") REFERENCES "Certification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerTaskSelection" ADD CONSTRAINT "WorkerTaskSelection_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerTaskSelection" ADD CONSTRAINT "WorkerTaskSelection_serviceTaskId_fkey" FOREIGN KEY ("serviceTaskId") REFERENCES "ServiceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: backfill WorkerServiceCategory from the old implicit m2m
-- table (_ServiceTypeToWorkerProfile: "A" = ServiceType.id, "B" =
-- WorkerProfile.id, Prisma's alphabetical-by-model-name convention) — every
-- existing worker<->category connection becomes VERIFIED immediately, with
-- no retroactive gate applied to any pre-existing worker.
INSERT INTO "WorkerServiceCategory" ("id", "workerProfileId", "serviceTypeId", "status", "verifiedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, jt."B", jt."A", 'VERIFIED', now(), now(), now()
FROM "_ServiceTypeToWorkerProfile" jt;

-- DataMigration: backfill WorkerTaskSelection — every active ServiceTask
-- under an already-connected category is treated as already-selected,
-- regardless of pricing model. This is what preserves CUSTOM_QUOTE task
-- eligibility for existing workers, who have no WorkerTaskPrice row to
-- backfill selection from (CUSTOM_QUOTE tasks never get one — priced
-- on-site) and would otherwise silently lose bookability the moment
-- WorkerTaskSelection becomes the gating signal for those tasks.
INSERT INTO "WorkerTaskSelection" ("id", "workerProfileId", "serviceTaskId", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, jt."B", st."id", true, now(), now()
FROM "_ServiceTypeToWorkerProfile" jt
JOIN "ServiceTask" st ON st."serviceTypeId" = jt."A" AND st."isActive" = true;

-- DropForeignKey
ALTER TABLE "_ServiceTypeToWorkerProfile" DROP CONSTRAINT "_ServiceTypeToWorkerProfile_A_fkey";

-- DropForeignKey
ALTER TABLE "_ServiceTypeToWorkerProfile" DROP CONSTRAINT "_ServiceTypeToWorkerProfile_B_fkey";

-- DropTable
DROP TABLE "_ServiceTypeToWorkerProfile";
