-- CreateEnum
CREATE TYPE "TaxCertificateStatus" AS ENUM ('DRAFT', 'ISSUED');

-- CreateEnum
CREATE TYPE "TaxRemittanceStatus" AS ENUM ('PENDING', 'REMITTED');

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "tin" TEXT,
ADD COLUMN     "tinVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TaxCertificate" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "workerName" TEXT NOT NULL,
    "workerTin" TEXT NOT NULL,
    "totalIncomePayments" DOUBLE PRECISION NOT NULL,
    "totalTaxWithheld" DOUBLE PRECISION NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "status" "TaxCertificateStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRemittance" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalTaxWithheld" DOUBLE PRECISION NOT NULL,
    "status" "TaxRemittanceStatus" NOT NULL DEFAULT 'PENDING',
    "referenceNumber" TEXT,
    "remittedAt" TIMESTAMP(3),
    "remittedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRemittance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxCertificate_workerId_idx" ON "TaxCertificate"("workerId");

-- CreateIndex
CREATE INDEX "TaxCertificate_status_idx" ON "TaxCertificate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCertificate_workerId_periodStart_periodEnd_key" ON "TaxCertificate"("workerId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "TaxRemittance_status_idx" ON "TaxRemittance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRemittance_periodStart_periodEnd_key" ON "TaxRemittance"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerProfile_tin_key" ON "WorkerProfile"("tin");

-- RenameIndex
ALTER INDEX "WalletTransaction_paymongoCheckoutId_key" RENAME TO "WalletTransaction_xenditInvoiceId_key";

