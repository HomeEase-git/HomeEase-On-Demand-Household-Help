-- CreateEnum
CREATE TYPE "ServiceScopeType" AS ENUM ('ROOM_BASED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ScopeFieldType" AS ENUM ('TEXT', 'SELECT', 'MULTI_SELECT');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "scopeAnswers" JSONB;

-- AlterTable
ALTER TABLE "ServiceType" ADD COLUMN     "hasCondition" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "scopeType" "ServiceScopeType" NOT NULL DEFAULT 'ROOM_BASED';

-- CreateTable
CREATE TABLE "ServiceScopeField" (
    "id" TEXT NOT NULL,
    "serviceTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "ScopeFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceScopeField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceScopeFieldOption" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceScopeFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceScopeField_serviceTypeId_idx" ON "ServiceScopeField"("serviceTypeId");

-- CreateIndex
CREATE INDEX "ServiceScopeFieldOption_fieldId_idx" ON "ServiceScopeFieldOption"("fieldId");

-- AddForeignKey
ALTER TABLE "ServiceScopeField" ADD CONSTRAINT "ServiceScopeField_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceScopeFieldOption" ADD CONSTRAINT "ServiceScopeFieldOption_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ServiceScopeField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

