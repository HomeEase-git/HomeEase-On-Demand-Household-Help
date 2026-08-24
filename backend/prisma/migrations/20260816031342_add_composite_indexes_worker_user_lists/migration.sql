-- CreateIndex
CREATE INDEX "User_role_isDeleted_createdAt_idx" ON "User"("role", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "WorkerProfile_isAvailable_kycStatus_idx" ON "WorkerProfile"("isAvailable", "kycStatus");
