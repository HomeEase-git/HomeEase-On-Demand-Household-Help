-- Worker debt hold limit raised from 500 to 2500 (adviser note). Only the
-- untouched default is moved; a value an admin already changed is kept.
ALTER TABLE "AppSettings" ALTER COLUMN "workerDebtHoldLimit" SET DEFAULT 2500;
UPDATE "AppSettings" SET "workerDebtHoldLimit" = 2500 WHERE "workerDebtHoldLimit" = 500;
