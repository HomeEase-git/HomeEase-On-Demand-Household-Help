-- Workers file their own taxes (2026-10 panel revision): HomeEase withholds
-- nothing and adds no VAT. Non-destructive: TIN, VAT-registration and the
-- TaxCertificate / TaxRemittance / VatCollectionSummary history are kept.
ALTER TABLE "AppSettings" ALTER COLUMN "withholdingTaxRate" SET DEFAULT 0;
UPDATE "AppSettings" SET "withholdingTaxRate" = 0;
ALTER TABLE "Payment" ALTER COLUMN "withholdingTaxRate" SET DEFAULT 0;
