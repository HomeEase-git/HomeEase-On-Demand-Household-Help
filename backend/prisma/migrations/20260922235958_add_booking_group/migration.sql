-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "BookingGroup" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "totalDays" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingGroup_clientId_idx" ON "BookingGroup"("clientId");

-- CreateIndex
CREATE INDEX "BookingGroup_workerId_idx" ON "BookingGroup"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingGroup_clientId_idempotencyKey_key" ON "BookingGroup"("clientId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Booking_groupId_idx" ON "Booking"("groupId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BookingGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingGroup" ADD CONSTRAINT "BookingGroup_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingGroup" ADD CONSTRAINT "BookingGroup_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
