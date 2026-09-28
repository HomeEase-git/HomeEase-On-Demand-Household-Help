-- Refresh-token rotation reuse detection (see AuthToken.usedAt).
ALTER TABLE "AuthToken" ADD COLUMN "usedAt" TIMESTAMP(3);
