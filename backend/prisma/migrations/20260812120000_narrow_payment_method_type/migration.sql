-- Narrow PaymentMethodType to GCASH, MAYA, CASH — CARD and BANK_TRANSFER are
-- no longer offered as a payment method or payout channel. Any existing
-- CARD/BANK_TRANSFER rows must already be reassigned before this migration
-- runs, since a Postgres enum swap cannot proceed while columns still
-- reference the values being dropped.

CREATE TYPE "PaymentMethodType_new" AS ENUM ('GCASH', 'MAYA', 'CASH');

ALTER TABLE "Payment" ALTER COLUMN "methodType" TYPE "PaymentMethodType_new" USING ("methodType"::text::"PaymentMethodType_new");
ALTER TABLE "Booking" ALTER COLUMN "paymentMethodType" TYPE "PaymentMethodType_new" USING ("paymentMethodType"::text::"PaymentMethodType_new");
ALTER TABLE "WorkerProfile" ALTER COLUMN "payoutMethod" TYPE "PaymentMethodType_new" USING ("payoutMethod"::text::"PaymentMethodType_new");
ALTER TABLE "Payout" ALTER COLUMN "channel" TYPE "PaymentMethodType_new" USING ("channel"::text::"PaymentMethodType_new");
ALTER TABLE "SavedPaymentMethod" ALTER COLUMN "type" TYPE "PaymentMethodType_new" USING ("type"::text::"PaymentMethodType_new");

DROP TYPE "PaymentMethodType";
ALTER TYPE "PaymentMethodType_new" RENAME TO "PaymentMethodType";
