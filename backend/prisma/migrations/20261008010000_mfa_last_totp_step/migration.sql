-- Remembers the last accepted TOTP step so a code can't be replayed within its
-- 30-90s window. Additive and nullable: safe for instances on the old code.
ALTER TABLE "MfaSecret" ADD COLUMN "lastTotpStep" INTEGER;
