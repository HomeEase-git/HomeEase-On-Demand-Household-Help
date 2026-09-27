-- WorkerProfile.tin is now stored encrypted (enc:v1:… — see
-- utils/fieldEncryption.ts), and the same TIN encrypts differently every time,
-- so the uniqueness guarantee moves to a deterministic keyed hash. Existing
-- plaintext rows keep working; scripts/encrypt-sensitive-fields.ts backfills
-- tin (encrypted) and tinHash for them.
DROP INDEX "WorkerProfile_tin_key";

ALTER TABLE "WorkerProfile" ADD COLUMN "tinHash" TEXT;

CREATE UNIQUE INDEX "WorkerProfile_tinHash_key" ON "WorkerProfile"("tinHash");
