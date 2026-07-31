-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "payoutMethod" "PaymentMethodType",
ADD COLUMN     "payoutAccountName" TEXT,
ADD COLUMN     "payoutAccountNumber" TEXT;

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Skill_workerProfileId_idx" ON "Skill"("workerProfileId");

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
