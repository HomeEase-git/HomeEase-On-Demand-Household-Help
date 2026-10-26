-- Drops tables and columns nothing reads or writes any more:
-- the retired tax records (TIN, VAT registration, 2307 certificates, VAT
-- summaries; workers file their own taxes since 2026-10), the time-slot
-- availability tables, worker-set and tiered task prices, per-city price
-- rules, card-era Payment fields and retired AppSettings knobs.
-- DESTRUCTIVE: back up first (see docs/DATA-RESILIENCE.md). TaxRemittance is
-- kept because ledgerOpeningService reads it; Payment/Booking tax snapshots
-- are kept as financial history.

-- AlterTable
ALTER TABLE "WorkerProfile" DROP COLUMN "tin",
DROP COLUMN "tinHash",
DROP COLUMN "tinVerifiedAt",
DROP COLUMN "vatDocumentUrl",
DROP COLUMN "vatRegistered",
DROP COLUMN "vatRejectionReason",
DROP COLUMN "vatReviewedAt",
DROP COLUMN "vatReviewedById",
DROP COLUMN "vatSubmittedAt",
DROP COLUMN "vatThresholdFlaggedAt",
DROP COLUMN "vatVerificationStatus";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "rescheduledFromBookingId";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "authorizationId",
DROP COLUMN "clientSecret",
DROP COLUMN "paymentIntentId";

-- AlterTable
ALTER TABLE "AppSettings" DROP COLUMN "atcCode",
DROP COLUMN "maxSlotsPerDay",
DROP COLUMN "noShowGraceHours",
DROP COLUMN "withholdingTaxRate";

-- DropTable
DROP TABLE "WorkerAvailability";
DROP TABLE "WorkerAvailabilityTemplate";
DROP TABLE "WorkerTaskPrice";
DROP TABLE "WorkerTaskTierPrice";
DROP TABLE "PricingRule";
DROP TABLE "TaxCertificate";
DROP TABLE "VatCollectionSummary";

-- DropEnum
DROP TYPE "TaxCertificateStatus";
