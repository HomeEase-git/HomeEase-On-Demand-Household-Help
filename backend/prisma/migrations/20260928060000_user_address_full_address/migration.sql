-- AlterTable
ALTER TABLE "UserAddress" ADD COLUMN "fullAddress" TEXT;

-- Backfill existing rows from their structured parts, same order the app
-- used to display them (house/street, barangay, city, province + ZIP).
UPDATE "UserAddress"
SET "fullAddress" = NULLIF(CONCAT_WS(', ',
  NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM("houseNumber"), ''), NULLIF(TRIM("street"), ''))), ''),
  'Barangay ' || NULLIF(TRIM("barangay"), ''),
  NULLIF(TRIM("city"), ''),
  NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM("state"), ''), NULLIF(TRIM("zipCode"), ''))), '')
), '')
WHERE "fullAddress" IS NULL;
