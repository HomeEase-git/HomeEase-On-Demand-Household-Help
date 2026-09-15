-- AlterTable
ALTER TABLE "BookingAddOn" ADD COLUMN     "clientApprovedAt" TIMESTAMP(3),
ADD COLUMN     "clientRejectedAt" TIMESTAMP(3);

-- Backfill: every add-on that already exists was created under the old
-- no-approval-needed system, and its price is already baked into whatever
-- finalPrice a client may have already agreed to or been billed for.
-- Leaving these NULL would make the new "pending add-ons are excluded from
-- finalPrice" logic retroactively strip real money off in-flight or already-
-- settled bookings. Grandfather them all in as approved at migration time;
-- only add-ons created after this point go through the real approval flow.
UPDATE "BookingAddOn" SET "clientApprovedAt" = now() WHERE "clientApprovedAt" IS NULL;
