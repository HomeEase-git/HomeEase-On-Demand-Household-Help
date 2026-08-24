-- Household-service workers are contractors under BIR rules (ATC WC158), not
-- professional-fee earners — the platform-wide default withholding rate was
-- wrongly set to the 5% professional-fee rate. Correct default is 2%.
-- Column defaults only apply to new rows, so the live AppSettings singleton
-- row is updated explicitly here too. Historical Payment rows are left
-- untouched — they reflect the rate actually applied to that transaction.

ALTER TABLE "AppSettings" ALTER COLUMN "withholdingTaxRate" SET DEFAULT 0.02;
ALTER TABLE "Payment" ALTER COLUMN "withholdingTaxRate" SET DEFAULT 0.02;

UPDATE "AppSettings" SET "withholdingTaxRate" = 0.02 WHERE "id" = 'singleton' AND "withholdingTaxRate" = 0.05;
