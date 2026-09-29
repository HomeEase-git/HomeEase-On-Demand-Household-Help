-- Retention purge (services/dataRetentionService.ts) filters on these.
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- Deletes sign-in audit entries older than a year: the only audit rows the
-- app ever removes. SECURITY DEFINER runs it with the table owner's rights,
-- so the app's own database role (scripts/db-roles.ts) can stay unable to
-- UPDATE or DELETE audit rows at all, and still call this. The cut-off is
-- fixed here, so calling it can never remove recent entries.
-- "createdAt" is timestamp without time zone holding UTC (Prisma's
-- convention), hence the explicit AT TIME ZONE.
CREATE FUNCTION purge_expired_login_audit() RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH purged AS (
    DELETE FROM "AuditLog"
    WHERE category = 'LOGIN'
      AND "createdAt" < (now() AT TIME ZONE 'UTC') - interval '365 days'
    RETURNING 1
  )
  SELECT count(*)::integer FROM purged;
$$;

REVOKE ALL ON FUNCTION purge_expired_login_audit() FROM PUBLIC;
