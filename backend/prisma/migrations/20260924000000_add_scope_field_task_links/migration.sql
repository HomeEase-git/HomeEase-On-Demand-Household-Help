-- CreateTable
CREATE TABLE "ServiceScopeFieldTask" (
    "fieldId" TEXT NOT NULL,
    "serviceTaskId" TEXT NOT NULL,

    CONSTRAINT "ServiceScopeFieldTask_pkey" PRIMARY KEY ("fieldId","serviceTaskId")
);

-- CreateIndex
CREATE INDEX "ServiceScopeFieldTask_serviceTaskId_idx" ON "ServiceScopeFieldTask"("serviceTaskId");

-- AddForeignKey
ALTER TABLE "ServiceScopeFieldTask" ADD CONSTRAINT "ServiceScopeFieldTask_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ServiceScopeField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceScopeFieldTask" ADD CONSTRAINT "ServiceScopeFieldTask_serviceTaskId_fkey" FOREIGN KEY ("serviceTaskId") REFERENCES "ServiceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
