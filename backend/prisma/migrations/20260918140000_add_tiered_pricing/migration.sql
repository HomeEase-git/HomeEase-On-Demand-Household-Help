-- AlterEnum
ALTER TYPE "TaskPricingModel" ADD VALUE 'TIERED';

-- CreateTable
CREATE TABLE "WorkerTaskTierPrice" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "serviceTaskId" TEXT NOT NULL,
    "upToQty" DOUBLE PRECISION,
    "price" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerTaskTierPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerTaskTierPrice_workerProfileId_serviceTaskId_idx" ON "WorkerTaskTierPrice"("workerProfileId", "serviceTaskId");

-- AddForeignKey
ALTER TABLE "WorkerTaskTierPrice" ADD CONSTRAINT "WorkerTaskTierPrice_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerTaskTierPrice" ADD CONSTRAINT "WorkerTaskTierPrice_serviceTaskId_fkey" FOREIGN KEY ("serviceTaskId") REFERENCES "ServiceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
