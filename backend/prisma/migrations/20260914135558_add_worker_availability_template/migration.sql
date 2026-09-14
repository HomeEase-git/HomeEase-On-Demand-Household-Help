-- CreateTable
CREATE TABLE "WorkerAvailabilityTemplate" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "timeSlot" "TimeSlot" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerAvailabilityTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerAvailabilityTemplate_workerProfileId_dayOfWeek_timeSl_key" ON "WorkerAvailabilityTemplate"("workerProfileId", "dayOfWeek", "timeSlot");

-- AddForeignKey
ALTER TABLE "WorkerAvailabilityTemplate" ADD CONSTRAINT "WorkerAvailabilityTemplate_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
