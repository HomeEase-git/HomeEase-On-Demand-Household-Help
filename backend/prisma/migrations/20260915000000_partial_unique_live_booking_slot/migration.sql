-- Replace the plain unique index on (workerId, scheduledDate, timeSlot) with
-- a PARTIAL unique index that only applies to "live" bookings.
--
-- Bookings are never deleted (no `booking.delete` call anywhere in this
-- codebase), so the old unqualified unique index meant a single REJECTED or
-- CANCELLED booking permanently occupied its (workerId, scheduledDate,
-- timeSlot) tuple forever. WorkerAvailability correctly marks the slot as
-- open again (see workerController.declineBooking / cancelBooking calling
-- freeSlot), so a client re-booking that exact worker for that exact date +
-- timeSlot would see the slot as available, submit, and hit a permanent,
-- misleading "Slot no longer available" 409 on the insert.
--
-- This index is intentionally NOT declared in schema.prisma — Prisma has no
-- schema-DSL support for a partial (WHERE-qualified) Postgres unique index.
-- See the comment on the Booking model in schema.prisma before touching
-- this again.
DROP INDEX "Booking_workerId_scheduledDate_timeSlot_key";

CREATE UNIQUE INDEX "worker_live_slot_unique" ON "Booking"("workerId", "scheduledDate", "timeSlot")
WHERE "status" NOT IN ('REJECTED', 'CANCELLED');
