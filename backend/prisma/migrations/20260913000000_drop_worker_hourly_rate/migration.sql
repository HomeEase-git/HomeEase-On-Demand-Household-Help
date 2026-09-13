-- Removes the worker-set hourly rate. It was never read by the actual
-- booking price calculation (bookingController.createBooking prices off
-- ServiceType/ServiceTask.basePrice + condition/urgency/tier fees, none of
-- which are hourly), only by the search-results "estimated total" preview —
-- so it showed clients a number that had no relationship to what they'd
-- actually pay, and doesn't fit categories that aren't priced by the hour.
-- Worker-level pricing differentiation is tier-based (see workerTier.ts) and
-- via priced WorkerPackage add-ons instead.
ALTER TABLE "WorkerProfile" DROP COLUMN "hourlyRate";
