# Monitoring and security alerts

What HomeEase watches, who gets told, and what to do when an alert arrives.
For the secrets themselves, see [SECRETS.md](SECRETS.md).

## What's in place

| Layer | What it does | Where to look |
|---|---|---|
| **Security alerts** | Suspicious events are emailed to the security contacts and reported to Sentry (see the table below) | Email; Sentry; admin site → Reports → Logs → **Security** |
| **Audit log** | Every alert, plus sign-ins, admin actions and password changes | Admin site → Reports → Logs |
| **Error reports** | Crashes and `console.error` calls from the backend, admin site and app (#116) | Sentry (once DSNs are set) |
| **Structured logs** | One JSON line per request, plus every log call, with request id and user id. Passwords, tokens, keys and query strings are scrubbed | Render → backend → Logs |
| **Request ids** | Every API response carries `X-Request-Id`. The same id is on its log lines, Sentry errors and security alerts | Search Render logs or Sentry for the id |
| **Keep-alive** | Pings `/health` every 5 minutes so the free Render service doesn't sleep | GitHub → Actions → "Keep backend awake" |

## Security alerts

Recipients are the addresses in `SECURITY_ALERT_EMAIL` (comma-separated). If it's unset, every active admin gets them.

Each kind of alert is emailed **at most once per 15 minutes**, per account where that makes sense. Further occurrences are still written to the audit log, and the next email says how many there were. An attack therefore can't flood the inbox or use up the Sentry quota, but nothing goes unrecorded.

| Alert | Severity | Meaning | What to do |
|---|---|---|---|
| `REFRESH_TOKEN_REUSE` | High | A sign-in token was used after it had already been replaced: a copy exists somewhere else. That session was ended automatically, and the user was emailed. | Once is usually a glitch (e.g. a restored phone backup). Repeats for one account mean their device or network is compromised: ask them to change their password. For an admin: rotate their password and check the audit log for their recent actions. |
| `LOGIN_LOCKOUT` (admin) | High | 10 wrong passwords on an admin account within 15 minutes. | Confirm with that admin. If it wasn't them, someone is targeting the account: keep MFA on, change the password, and check where the attempts came from (IP in the alert). |
| `LOGIN_LOCKOUT` (others) | Medium | An account (or an unregistered email) locked after 10 wrong passwords. One email per 15 minutes covers all of them, with a count. | A few a day is normal. Dozens at once is password spraying: the per-account lockout and IP rate limits are already working. If it continues, consider putting Cloudflare in front of the API. |
| `MFA_LOCKOUT` | High | 5 wrong two-step codes **after a correct password**. | Treat that account's password as known to someone else: reset it now, and check whether the owner did this. |
| `ADMIN_MFA_DISABLED` | High | An admin turned off two-step sign-in. | Confirm with that admin. If it wasn't them, the account is taken over: reset the password and MFA (`scripts/reset-admin-mfa.ts`), then review their recent audit-log actions. |
| `ADMIN_PASSWORD_CHANGED` | Medium | An admin's password was changed or reset. | Confirm it was them. |
| `ADMIN_ROUTE_DENIED` | Medium | A client or worker account called an admin-only endpoint. The apps never do this, so someone is exploring the API with a real account. | Check the account in the alert. Repeated probing is grounds to suspend it. |
| `XENDIT_WEBHOOK_INVALID_TOKEN`, `XENDIT_PAYOUT_WEBHOOK_INVALID_TOKEN` | Medium | A "payment" webhook arrived with the wrong token and was rejected. | If it starts right after a token change, update `XENDIT_WEBHOOK_TOKEN` on Render to match Xendit's dashboard. Otherwise someone is trying to fake payments; the rejection already stopped it. |
| `CRON_SECRET_INVALID` | Medium | `/internal/cron` was called with a wrong or missing secret. | If the hourly "Cron sweeps" workflow is failing too, the GitHub secret and Render's `CRON_SECRET` don't match (see SECRETS.md). Otherwise it's probing, and it was refused. |

Users are also emailed directly when their password is changed or reset, and when one of their sessions is ended because its token was copied.

## Account-side setup (do once)

1. **Security contact.** Render → backend → Environment → `SECURITY_ALERT_EMAIL` = the address(es) that should get alerts. Use one that's checked daily, and ideally not one of the admin accounts being watched. If it's left unset, alerts go to every admin.
2. **Sentry alert rules** (after the DSNs from DEPLOY.md's checklist are set). Sentry → the Node project → Alerts → Create alert:
   - "A new issue is created" → email: new kinds of backend errors.
   - "The issue is seen more than 20 times in 1 hour" → email: error spikes.
   - "An event's tags match `security_event` is set" → email: a second channel for security alerts, independent of Brevo.
3. **External uptime monitor** (free: UptimeRobot or Better Stack):
   - Monitor `https://<render-url>/health/ready` every 5 minutes, alerting when it isn't HTTP 200. It returns 503 when the database is unreachable.
   - Optionally add the admin site URL as a second monitor.
   - This is the alert for "the whole thing is down". The GitHub keep-alive only keeps the service awake and isn't reliable enough to alert on.
4. **Log retention.** Render keeps logs for a limited time on the free plan. To keep security-relevant logs longer (the Data Privacy Act expects an audit trail), use Render → Settings → Log Streams to forward them to a log service, or rely on the audit log in the database. The audit log is where every alert lives permanently.

## Logs: settings and tips

- **`LOG_FORMAT`**: production logs JSON by default. `LOG_FORMAT=pretty` switches back to plain text (e.g. while debugging on Render); `LOG_FORMAT=json` turns JSON on locally.
- To follow one request, search Render logs for its `requestId`. A user can find it in the `X-Request-Id` response header, and Sentry shows it as the `request_id` tag.
- To see one user's activity, search for `"userId":"<id>"`.
- Anything under a key like `password`, `token`, `secret`, `otp`, `tin` or `accountNumber` is logged as `[REDACTED]`. JWTs, bearer tokens, provider keys, database URL passwords and encrypted fields are scrubbed from any text. The rules are in `backend/src/utils/logRedaction.ts`; extend them there, never loosen them.
