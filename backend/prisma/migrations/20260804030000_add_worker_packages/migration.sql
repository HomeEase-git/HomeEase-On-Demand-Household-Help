-- CreateTable
CREATE TABLE "WorkerPackage" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerPackage_workerProfileId_idx" ON "WorkerPackage"("workerProfileId");

-- CreateIndex
CREATE INDEX "WorkerPackage_serviceTypeId_idx" ON "WorkerPackage"("serviceTypeId");

-- AddForeignKey
ALTER TABLE "WorkerPackage" ADD CONSTRAINT "WorkerPackage_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerPackage" ADD CONSTRAINT "WorkerPackage_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

