-- AlterTable
ALTER TABLE "ServiceScopeField" ADD COLUMN     "helpText" TEXT;

-- AlterTable
ALTER TABLE "ServiceTask" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;
