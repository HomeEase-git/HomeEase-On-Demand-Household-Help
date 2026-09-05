-- Removes the unused cancellation-fee scaffolding — never read or written
-- by any real controller (only referenced in seed-complete.ts's demo data),
-- and no longer relevant now that a client cannot cancel a booking past
-- PENDING at all (see cancelBooking's new role/status check), so there is
-- no "cancel for a fee" path to track.
ALTER TABLE "Cancellation" DROP COLUMN "feeCharged",
DROP COLUMN "refundAmount";
