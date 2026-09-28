-- Tax periods are Philippine calendar periods: a quarter starts at midnight
-- Manila time (UTC+8), not midnight UTC. Period keys used to be stored at
-- midnight UTC, which put payments captured between 00:00 and 08:00 Manila on
-- a boundary day into the wrong period. Move existing keys to Manila midnight
-- (8 hours earlier) — flagging first, using the old bounds, any record whose
-- figure changes because a payment falls in those 8 hours.

-- AlterTable
ALTER TABLE "TaxCertificate" ADD COLUMN     "monthlyBreakdown" JSONB;

-- Certificates: flag issued ones whose worker had a payment in a boundary gap.
UPDATE "TaxCertificate" c
SET "status" = 'NEEDS_REVIEW'
WHERE c."status" = 'ISSUED'
  AND date_trunc('day', c."periodStart") = c."periodStart"
  AND date_trunc('day', c."periodEnd") = c."periodEnd"
  AND EXISTS (
    SELECT 1 FROM "Payment" p JOIN "Booking" b ON b."id" = p."bookingId"
    WHERE b."workerId" = c."workerId"
      AND p."status" = 'COMPLETED'
      AND (
        (p."capturedAt" >= c."periodStart" - interval '8 hours' AND p."capturedAt" < c."periodStart")
        OR (p."capturedAt" >= c."periodEnd" - interval '8 hours' AND p."capturedAt" < c."periodEnd")
      )
  );

UPDATE "TaxCertificate"
SET "periodStart" = "periodStart" - interval '8 hours',
    "periodEnd" = "periodEnd" - interval '8 hours'
WHERE date_trunc('day', "periodStart") = "periodStart"
  AND date_trunc('day', "periodEnd") = "periodEnd";

-- Remittances: the recorded figure is what was filed; flag it if the Manila
-- period would have held a different amount.
UPDATE "TaxRemittance" r
SET "status" = 'NEEDS_REVIEW'
WHERE r."status" = 'REMITTED'
  AND date_trunc('day', r."periodStart") = r."periodStart"
  AND date_trunc('day', r."periodEnd") = r."periodEnd"
  AND EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p."status" = 'COMPLETED'
      AND p."withholdingTaxAmount" > 0
      AND (
        (p."capturedAt" >= r."periodStart" - interval '8 hours' AND p."capturedAt" < r."periodStart")
        OR (p."capturedAt" >= r."periodEnd" - interval '8 hours' AND p."capturedAt" < r."periodEnd")
      )
  );

UPDATE "TaxRemittance"
SET "periodStart" = "periodStart" - interval '8 hours',
    "periodEnd" = "periodEnd" - interval '8 hours'
WHERE date_trunc('day', "periodStart") = "periodStart"
  AND date_trunc('day', "periodEnd") = "periodEnd";

-- VAT summaries.
UPDATE "VatCollectionSummary" v
SET "needsReview" = true
WHERE date_trunc('day', v."periodStart") = v."periodStart"
  AND date_trunc('day', v."periodEnd") = v."periodEnd"
  AND EXISTS (
    SELECT 1 FROM "Payment" p JOIN "Booking" b ON b."id" = p."bookingId"
    WHERE b."workerId" = v."workerId"
      AND p."status" = 'COMPLETED'
      AND p."vatAmount" > 0
      AND (
        (p."capturedAt" >= v."periodStart" - interval '8 hours' AND p."capturedAt" < v."periodStart")
        OR (p."capturedAt" >= v."periodEnd" - interval '8 hours' AND p."capturedAt" < v."periodEnd")
      )
  );

UPDATE "VatCollectionSummary"
SET "periodStart" = "periodStart" - interval '8 hours',
    "periodEnd" = "periodEnd" - interval '8 hours'
WHERE date_trunc('day', "periodStart") = "periodStart"
  AND date_trunc('day', "periodEnd") = "periodEnd";
