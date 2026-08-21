-- AlterEnum
-- Drops BOOKING_RESCHEDULED (the reschedule feature was removed; verified
-- zero Notification rows use this value before writing this migration) and
-- adds the reminder/auto-action notification types used by the quote and
-- completion timeout jobs.
CREATE TYPE "NotificationType_new" AS ENUM ('BOOKING_REQUEST', 'BOOKING_ACCEPTED', 'BOOKING_REJECTED', 'BOOKING_CANCELLED', 'BOOKING_COMPLETED', 'PAYMENT_RECEIVED', 'PAYMENT_REFUNDED', 'ADDON_ADDED', 'REVIEW_RECEIVED', 'MESSAGE_RECEIVED', 'VERIFICATION_EMAIL', 'PASSWORD_RESET', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED', 'QUOTE_DISPUTED', 'QUOTE_REMINDER', 'QUOTE_AUTO_APPROVED', 'COMPLETION_REMINDER', 'BOOKING_AUTO_COMPLETED', 'VERIFICATION_SUBMITTED', 'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED', 'PAYOUT_SENT', 'PAYOUT_FAILED');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN "addressLat" DOUBLE PRECISION,
ADD COLUMN "addressLng" DOUBLE PRECISION;
