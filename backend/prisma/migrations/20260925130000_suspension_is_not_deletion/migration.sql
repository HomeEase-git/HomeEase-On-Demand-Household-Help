-- Suspending or banning a user used to also set isDeleted/deletedAt, which
-- hid them from admin lists and made them indistinguishable from accounts
-- the user deleted themselves (the Data Privacy Act erasure flow). Those
-- flags now mean self-deletion only; clear them on suspended/banned users.
UPDATE "User"
SET "isDeleted" = false, "deletedAt" = NULL
WHERE "status" IN ('SUSPENDED', 'BANNED') AND "isDeleted" = true;
