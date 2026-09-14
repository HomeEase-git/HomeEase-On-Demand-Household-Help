-- CreateEnum
CREATE TYPE "TaskPricingModel" AS ENUM ('FIXED', 'PER_UNIT', 'CUSTOM_QUOTE');

-- AlterTable
ALTER TABLE "ServiceTask" ADD COLUMN     "maxPrice" DOUBLE PRECISION,
ADD COLUMN     "minPrice" DOUBLE PRECISION,
ADD COLUMN     "pricingModel" "TaskPricingModel" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "quantityScopeFieldId" TEXT,
ADD COLUMN     "unitLabel" TEXT,
ALTER COLUMN "durationHours" DROP NOT NULL;

-- CreateTable
CREATE TABLE "WorkerTaskPrice" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "serviceTaskId" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerTaskPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerTaskPrice_serviceTaskId_idx" ON "WorkerTaskPrice"("serviceTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerTaskPrice_workerProfileId_serviceTaskId_key" ON "WorkerTaskPrice"("workerProfileId", "serviceTaskId");

-- CreateIndex
CREATE INDEX "ServiceTask_quantityScopeFieldId_idx" ON "ServiceTask"("quantityScopeFieldId");

-- AddForeignKey
ALTER TABLE "ServiceTask" ADD CONSTRAINT "ServiceTask_quantityScopeFieldId_fkey" FOREIGN KEY ("quantityScopeFieldId") REFERENCES "ServiceScopeField"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerTaskPrice" ADD CONSTRAINT "WorkerTaskPrice_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerTaskPrice" ADD CONSTRAINT "WorkerTaskPrice_serviceTaskId_fkey" FOREIGN KEY ("serviceTaskId") REFERENCES "ServiceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: seed minPrice/maxPrice for every existing task from its
-- basePrice, using the same 0.8x-1.6x spread seed-catalog.ts already uses
-- for PricingRule bounds, so the new admin-allowed range isn't arbitrarily
-- different from the city pricing bands already live. Admin can tighten
-- these later via the new task-editing UI (see adminServiceTypeController).
UPDATE "ServiceTask"
SET "minPrice" = ROUND(("basePrice" * 0.8)::numeric, 2),
    "maxPrice" = ROUND(("basePrice" * 1.6)::numeric, 2)
WHERE "minPrice" IS NULL AND "maxPrice" IS NULL;
