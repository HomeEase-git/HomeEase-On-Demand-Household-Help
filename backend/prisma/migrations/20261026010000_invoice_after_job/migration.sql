-- The worker bills on an invoice after the job; quotes are retired.
-- Invoice lines reuse BookingAddOn (kind + photos). Quote columns, statuses
-- and BookingQuoteItem stay for bookings quoted before this change.

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('PACKAGE', 'PREFERENCE', 'PART', 'EXTRA_WORK');

-- AlterTable
ALTER TABLE "BookingAddOn" ADD COLUMN "kind" "InvoiceLineKind",
ADD COLUMN "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- A quote the client hadn't approved no longer sets the price: back to the
-- booked price, and the worker starts the job as usual.
UPDATE "Booking"
SET "status" = 'ACCEPTED', "quoteStatus" = NULL, "laborCost" = NULL, "materialsCost" = NULL
WHERE "status" = 'QUOTE_SUBMITTED';

-- An approved quote keeps its agreed labor + materials (they still price the
-- booking); only the retired status goes.
UPDATE "Booking" SET "status" = 'ACCEPTED' WHERE "status" = 'QUOTE_APPROVED';

-- Custom-quote jobs have no price. Switch them off as flat jobs; the admin
-- prices them before switching them back on.
UPDATE "ServiceTask"
SET "pricingModel" = 'FIXED', "isActive" = false, "quantityScopeFieldId" = NULL
WHERE "pricingModel" = 'CUSTOM_QUOTE';
