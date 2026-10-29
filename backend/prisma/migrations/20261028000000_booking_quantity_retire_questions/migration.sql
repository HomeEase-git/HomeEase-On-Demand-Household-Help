-- Booking questions are retired. A per-unit job's quantity moves from the
-- answer to its quantity question onto the booking itself, and the
-- question's min/max limits move onto the job. Nothing is dropped: the old
-- question tables and Booking.scopeAnswers stay for old rows.

ALTER TABLE "ServiceTask" ADD COLUMN "minQuantity" DOUBLE PRECISION,
                          ADD COLUMN "maxQuantity" DOUBLE PRECISION;

ALTER TABLE "Booking" ADD COLUMN "quantity" DOUBLE PRECISION;

UPDATE "ServiceTask" t
SET "minQuantity" = f."minValue",
    "maxQuantity" = f."maxValue"
FROM "ServiceScopeField" f
WHERE t."quantityScopeFieldId" = f."id";

-- Only answers that are plain numbers are copied, so a stray text answer
-- can't fail the migration.
UPDATE "Booking" b
SET "quantity" = (b."scopeAnswers" ->> f."label")::DOUBLE PRECISION
FROM "ServiceTask" t
JOIN "ServiceScopeField" f ON f."id" = t."quantityScopeFieldId"
WHERE b."serviceTaskId" = t."id"
  AND b."quantity" IS NULL
  AND jsonb_typeof(b."scopeAnswers") = 'object'
  AND (b."scopeAnswers" ->> f."label") ~ '^\s*[0-9]+(\.[0-9]+)?\s*$';
