-- AlterEnum
ALTER TYPE "ScopeFieldType" ADD VALUE 'NUMBER';

-- DropForeignKey
ALTER TABLE "Skill" DROP CONSTRAINT "Skill_workerProfileId_fkey";

-- AlterTable
ALTER TABLE "ServiceScopeField" ADD COLUMN     "maxValue" DOUBLE PRECISION,
ADD COLUMN     "minValue" DOUBLE PRECISION,
ADD COLUMN     "usedForMatching" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ServiceType" DROP COLUMN "hasCondition",
DROP COLUMN "scopeType";

-- AlterTable
ALTER TABLE "WorkerProfile" DROP COLUMN "acceptsHeavyCondition",
DROP COLUMN "preferredRoomTypes";

-- DropTable
DROP TABLE "Skill";

-- DropEnum
DROP TYPE "ServiceScopeType";

-- CreateTable
CREATE TABLE "WorkerScopeFieldCapability" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerScopeFieldCapability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerScopeFieldCapability_optionId_idx" ON "WorkerScopeFieldCapability"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerScopeFieldCapability_workerProfileId_optionId_key" ON "WorkerScopeFieldCapability"("workerProfileId", "optionId");

-- AddForeignKey
ALTER TABLE "WorkerScopeFieldCapability" ADD CONSTRAINT "WorkerScopeFieldCapability_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerScopeFieldCapability" ADD CONSTRAINT "WorkerScopeFieldCapability_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ServiceScopeFieldOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

