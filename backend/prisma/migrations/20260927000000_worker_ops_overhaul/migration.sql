-- Worker operations overhaul: exact start times instead of time slots, a
-- weekly schedule + per-date overrides instead of slot availability, rush
-- (same-day) bookings, no-show cancellation with penalties, quote receipts,
-- follow-up jobs and visits, email/SMS two-step sign-in, worker deactivation,
-- per-device sessions, health certificate in KYC, years of experience for
-- expertise tiers.

-- Enums
ALTER TYPE "TokenType" ADD VALUE 'LOGIN_2FA';
ALTER TYPE "TokenType" ADD VALUE 'ACCOUNT_ACTION';
ALTER TYPE "QuoteStatus" ADD VALUE 'REJECTED';
ALTER TYPE "KycDocumentType" ADD VALUE 'HEALTH_CERTIFICATE';
ALTER TYPE "NotificationType" ADD VALUE 'QUOTE_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'FOLLOW_UP_VISIT_SCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'CANCELLATION_PENALTY';
ALTER TYPE "NotificationType" ADD VALUE 'CANCELLATION_COMPENSATION';
ALTER TYPE "UserStatus" ADD VALUE 'DEACTIVATED';
ALTER TYPE "DebtLedgerEntryType" ADD VALUE 'PENALTY';
ALTER TYPE "DebtLedgerEntryType" ADD VALUE 'COMPENSATION';

CREATE TYPE "TwoFactorMethod" AS ENUM ('EMAIL', 'SMS');
CREATE TYPE "CancellationFault" AS ENUM ('CLIENT', 'WORKER');

-- User / sessions
ALTER TABLE "User" ADD COLUMN "twoFactorMethod" "TwoFactorMethod",
ADD COLUMN "deactivatedAt" TIMESTAMP(3);

ALTER TABLE "AuthToken" ADD COLUMN "sessionId" TEXT;
CREATE INDEX "AuthToken_sessionId_idx" ON "AuthToken"("sessionId");

-- Worker profile
ALTER TABLE "WorkerProfile" ADD COLUMN "yearsExperience" INTEGER,
ADD COLUMN "compensationCredit" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE "WorkerDateOverride" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isAvailable" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerDateOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkerDateOverride_workerProfileId_date_key" ON "WorkerDateOverride"("workerProfileId", "date");
CREATE INDEX "WorkerDateOverride_date_idx" ON "WorkerDateOverride"("date");
ALTER TABLE "WorkerDateOverride" ADD CONSTRAINT "WorkerDateOverride_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Service catalog
ALTER TABLE "ServiceTask" ADD COLUMN "allowsFollowUp" BOOLEAN NOT NULL DEFAULT false;

-- Booking
ALTER TABLE "Booking" ADD COLUMN "parentBookingId" TEXT,
ADD COLUMN "isRush" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "quoteReceiptUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "quoteProofOfUseUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "quoteRejectedAt" TIMESTAMP(3),
ADD COLUMN "quoteRejectionReason" TEXT,
ADD COLUMN "quoteRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "rescheduleRequestedBy" "Role",
ADD COLUMN "requestedScheduledTime" TEXT;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_parentBookingId_fkey" FOREIGN KEY ("parentBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BookingVisit" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "scheduledTime" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingVisit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BookingVisit_bookingId_idx" ON "BookingVisit"("bookingId");
CREATE INDEX "BookingVisit_scheduledDate_idx" ON "BookingVisit"("scheduledDate");
ALTER TABLE "BookingVisit" ADD CONSTRAINT "BookingVisit_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PricingLog" ADD COLUMN "rushFee" DOUBLE PRECISION DEFAULT 0;

-- Cancellation
ALTER TABLE "Cancellation" ADD COLUMN "fault" "CancellationFault",
ADD COLUMN "proofUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "penaltyAmount" DOUBLE PRECISION,
ADD COLUMN "compensationAmount" DOUBLE PRECISION,
ADD COLUMN "compensationStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewNote" TEXT;
CREATE INDEX "Cancellation_compensationStatus_idx" ON "Cancellation"("compensationStatus");

-- Settings
ALTER TABLE "AppSettings" ADD COLUMN "workerMinAge" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN "workerMaxAge" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "rushFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
ADD COLUMN "rushMinLeadHours" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "noShowGraceMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "noShowPenaltyAmount" DOUBLE PRECISION NOT NULL DEFAULT 200,
ADD COLUMN "clientFaultCompensationAmount" DOUBLE PRECISION NOT NULL DEFAULT 200,
ADD COLUMN "tierProMinYears" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "tierExpertMinYears" INTEGER NOT NULL DEFAULT 5;

-- Workers may now take more than one job at the same date/time slot, and new
-- bookings have no time slot at all, so the one-live-booking-per-slot rule
-- goes (see migration 20260915000000_partial_unique_live_booking_slot).
DROP INDEX IF EXISTS "worker_live_slot_unique";

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

-- Existing bookings get an exact start time from their old slot, so the
-- no-show rule and calendars work for them too.
UPDATE "Booking" SET "scheduledTime" = CASE "timeSlot"
    WHEN 'MORNING' THEN '08:00'
    WHEN 'AFTERNOON' THEN '12:00'
    WHEN 'EVENING' THEN '16:00'
  END
WHERE "scheduledTime" IS NULL AND "timeSlot" IS NOT NULL;

-- A worker's old repeating weekly pattern becomes their weekly schedule.
UPDATE "WorkerProfile" wp
SET "availableDays" = t.days
FROM (
  SELECT "workerProfileId", array_agg(DISTINCT "dayOfWeek" ORDER BY "dayOfWeek") AS days
  FROM "WorkerAvailabilityTemplate"
  GROUP BY "workerProfileId"
) t
WHERE wp."id" = t."workerProfileId";

-- Upcoming days a worker had blocked off entirely (vacation, day off) stay
-- closed as date overrides.
INSERT INTO "WorkerDateOverride" ("id", "workerProfileId", "date", "isAvailable", "updatedAt")
SELECT 'wdo_' || md5(a."workerProfileId" || a."date"::text), a."workerProfileId", a."date", false, CURRENT_TIMESTAMP
FROM "WorkerAvailability" a
WHERE a."date" >= date_trunc('day', now())
GROUP BY a."workerProfileId", a."date"
HAVING bool_and(a."isBlocked" AND a."blockedByBookingId" IS NULL)
ON CONFLICT ("workerProfileId", "date") DO NOTHING;

-- Inspection / diagnosis jobs can have follow-up jobs.
UPDATE "ServiceTask" SET "allowsFollowUp" = true
WHERE "name" ~* '(inspect|diagnos|assess|survey|check-?up|troubleshoot)';
