-- AlterEnum
ALTER TYPE "TaxCertificateStatus" ADD VALUE 'NEEDS_REVIEW';

-- AlterEnum
ALTER TYPE "TaxRemittanceStatus" ADD VALUE 'NEEDS_REVIEW';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TAX_RECORDS_NEED_REVIEW';

-- AlterTable
ALTER TABLE "VatCollectionSummary" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false;
