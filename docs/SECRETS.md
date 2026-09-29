# Secrets: inventory and rotation

Every credential HomeEase uses, where it lives, what a leak would expose, and
how to replace it. Keep this file current when a secret is added or removed.

## Rules

- **Never commit a secret.** `.env` files are git-ignored. Production values
  live only in the hosting dashboards: Render (backend), Vercel (admin site)
  and EAS (Android build).
- **Keep a copy of `DATA_ENCRYPTION_KEY` and `MFA_ENCRYPTION_KEY` in a password
  manager.** If either is lost, every value it encrypted is unrecoverable, and
  so are the database backups that contain them.
- **A local `.env` pointing at production counts as a copy of the secret.**
  Rotate anything that has sat in one on a laptop that's lost, shared or
  retired.
- **The backend checks its configuration at startup** (`src/config/envCheck.ts`).
  In production it refuses to start if a required secret is missing or still
  a placeholder. Render then keeps the previous deploy running. It warns about
  short secrets and about a key rotation that's still in progress.

## Inventory

**Where it's set:** R = Render backend env, V = Vercel env, E = EAS env,
G = GitHub Actions secret, L = local `.env` only.

| Secret | Where | Protects | If it leaks | Rotate |
|---|---|---|---|---|
| `DIRECT_URL` (Neon owner password) | R, L | The whole database, schema included (migrations) | **Critical:** full control of all data | [Database password](#database-password) |
| `DATABASE_URL` (`homeease_app` password, once switched; see [DATA-RESILIENCE.md](DATA-RESILIENCE.md#database-roles)) | R | Rows in app tables | **Critical:** read/write of all rows, but no schema changes and no editing of audit or ledger entries | [Database password](#database-password) |
| `homeease_readonly` password | Password manager | Read-only access for reports and investigations | **High:** every row readable | [Database password](#database-password) |
| `DATA_ENCRYPTION_KEY` | R | Payout account numbers, TINs (and the TIN duplicate-check hash) | Encrypted fields readable, **if** the database also leaks | [Encryption keys](#encryption-keys) |
| `MFA_ENCRYPTION_KEY` | R | Admin authenticator-app secrets | Admin MFA codes could be generated, **if** the database also leaks | [Encryption keys](#encryption-keys) |
| `JWT_SECRET` | R | Signs every access token | Anyone can mint a token for any account, including admin | [JWT secret](#jwt-secret) |
| `XENDIT_SECRET_KEY` | R, L | Invoices, refunds, **payouts** | Money can be moved out of the Xendit balance | [Swap](#simple-swap) (Xendit → Settings → API keys) |
| `XENDIT_WEBHOOK_TOKEN` | R, L | Proves webhooks come from Xendit | Fake "paid" webhooks could complete unpaid bookings | [Xendit webhook token](#xendit-webhook-token) |
| `SUPABASE_SERVICE_KEY` | R, L | All storage buckets, including private KYC documents | **Critical:** every ID, selfie, resume and chat image | [Swap](#simple-swap) (Supabase → Project settings → API keys) |
| `SUPABASE_ANON_KEY` | R, L | Public-bucket access | Low: public data only | [Swap](#simple-swap) |
| `CRON_SECRET` | R, G | `/internal/cron` sweep trigger | Sweeps can be triggered early (they're safe to rerun) | [Cron secret](#cron-secret) |
| `BREVO_API_KEY` | R, L | Sending email as homeeaseondemand@gmail.com | Phishing from the real sender address | [Swap](#simple-swap) (Brevo → SMTP & API → API keys) |
| `PHILSMS_API_TOKEN` | R, L | Sending SMS | SMS credit spent, phishing texts | [Swap](#simple-swap) (PhilSMS dashboard) |
| `ANTHROPIC_API_KEY` | R, L | KYC document review | Usage billed to you | [Swap](#simple-swap) (console.anthropic.com → API keys) |
| `GOOGLE_MAPS_API_KEY` (server) | R, L | Places (New), Routes | Usage billed to you | [Google keys](#google-keys) |
| `GOOGLE_MAPS_ANDROID_API_KEY` | E | Maps SDK in the app (baked into the APK) | Not secret; protected by its restrictions | [Google keys](#google-keys) |
| Firebase key in `mobile/google-services.json` | git (by design) | Push notifications | Not secret; protected by its restrictions | [Google keys](#google-keys) |
| `SMTP_USER` / `SMTP_PASS` (Gmail app password) | L | Local email testing only | Mail sent as that Gmail account | Google Account → App passwords → revoke |
| `NEON_API_KEY` | L, G (restore drill) | Neon account (branches, databases) | **Critical:** can create, reset or delete databases, and read production | Neon → Account settings → API keys; update the GitHub secret |
| `SENTRY_DSN`, `VITE_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_DSN` | R, V, E | Where errors are reported | Not secret (ships in the apps); junk events at worst | New DSN in Sentry only if abused |
| `E2E_*` (GitHub) | G | Sandbox credentials for the Xendit E2E workflow | Sandbox only | Rotate alongside their sandbox source |
| Redis (`REDIS_URL`) | R (from Render Key Value) | Queues, rate limits, revocations | Only reachable inside Render | Not needed |

## Procedures

### Simple swap

This covers most third-party keys:

1. Create a **new** key in the provider's dashboard. Don't delete the old one yet.
2. Put it in Render → backend → Environment (and in your local `.env` if you keep one), then save. Render redeploys.
3. Check the feature it powers works (send a test email, open a KYC document, and so on).
4. Delete or revoke the old key in the provider's dashboard.

### Database password

**Owner (`DIRECT_URL`):**
1. Neon console → the `homeease-prod` project → Roles → reset the owner role's password.
2. Update `DIRECT_URL` on Render (and `DATABASE_URL` too, if it still uses the owner). Render redeploys. Old connections close as it restarts.
3. Confirm `/health/ready` shows `"status":"ready"`.
4. Update any local `.env`, or better, point local work at the dev project instead.

**`homeease_app` or `homeease_readonly`:** these are created by
`scripts/db-roles.ts`, not in the Neon console. Generate a new password in
the password manager, run
`DIRECT_URL="<owner direct URL>" APP_DB_PASSWORD="<new>" npx tsx scripts/db-roles.ts --rotate homeease_app --neon-websocket`,
put the printed pooled string, with the new password in place of
`PASSWORD`, in `DATABASE_URL` on Render, and confirm
`/health/ready`. The old password stops working the moment the script runs,
so do the Render update straight after.

### JWT secret

1. Render → set `JWT_SECRET` to a new value (`openssl rand -hex 32`) → save.
2. Effect: every access token becomes invalid. Current apps renew silently with their refresh token (refresh tokens don't depend on this secret), so users stay signed in. Anyone mid-way through an MFA or login-code sign-in has to start again. Android builds from before Security Phase 1 can't renew, so their users must sign in again.

### Encryption keys

`DATA_ENCRYPTION_KEY` and `MFA_ENCRYPTION_KEY` rotate the same way, and either can be rotated on its own.

1. Generate the new key with `openssl rand -hex 32` and store it in the password manager next to the old one.
2. At a quiet time, set `<KEY>_PREVIOUS` = the **old** value and `<KEY>` = the **new** value on Render, then save. The app now writes with the new key and reads with either. The startup log shows "rotation in progress", which is expected.
3. From `backend/`, with `DATABASE_URL` and both key values set exactly as on Render:
   ```bash
   npx tsx scripts/rotate-encryption-keys.ts --dry   # report what would change
   npx tsx scripts/rotate-encryption-keys.ts         # apply
   ```
   Add `--neon-websocket` if your network blocks direct Postgres connections to Neon.
   The script re-encrypts payout numbers, TINs and MFA secrets, and recomputes TIN hashes. It plans everything first and writes nothing if any value decrypts with neither key.
   If it reports rows edited during the run, run it again.
   If it reports two workers sharing a TIN, one was saved in the few seconds when old and new instances overlapped. Resolve it by hand, then run the script again.
   It is safe to run again; a second run reports 0 changes.
4. Check a worker's payout settings, and generate a tax certificate or sign in as an admin with MFA.
5. Remove `<KEY>_PREVIOUS` on Render.
6. **Keep the old key in the password manager until every database backup older than the rotation has expired.** Restoring one of those backups needs the old key.

### Xendit webhook token

The old and new tokens can't both be valid, so keep the gap short:

1. Xendit dashboard → Settings → Webhooks → regenerate the verification token.
2. Immediately update `XENDIT_WEBHOOK_TOKEN` on Render.
3. Webhooks that arrive in between are rejected and retried by Xendit. The reconciliation sweep also catches any payment it missed.

### Cron secret

1. Generate a new value (`openssl rand -hex 32`).
2. Set it in **both** Render (`CRON_SECRET`) and GitHub → Settings → Secrets → Actions (`CRON_SECRET`).
3. Run the "Cron sweeps" workflow manually to confirm it gets a 200.

### Google keys

- **Server key (`GOOGLE_MAPS_API_KEY`):** Google Cloud → APIs & Services → Credentials → the key → API restrictions: **Places API (New)** and **Routes API** only. Render has no fixed outbound IP, so an IP restriction isn't possible; the API restriction is the protection. To rotate, create a new key with the same restrictions, swap it on Render, then delete the old one.
- **Android Maps key (`GOOGLE_MAPS_ANDROID_API_KEY`):**
  - Application restriction: Android apps, package `com.homeease.app` plus the SHA-1 from `eas credentials` → Android → production keystore.
  - API restriction: **Maps SDK for Android** only.
  - To rotate, set a new value in EAS, then build a new APK.
- **Firebase key (`google-services.json`):** Google Cloud (project `homeease-dad3d`) → Credentials → "Android key (auto created by Firebase)":
  - Application restriction: the same package and SHA-1.
  - API restriction: the Firebase APIs the app uses (Firebase Installations, FCM Registration).
  - It doesn't need to be secret; the restrictions are what matter.

## Known past exposure

- **Resend API key (June 2026).** `backend/.env` was committed on 2026-06-23 (commit `27c6e75a`). It was removed two days later, but it's still in the public history and on the `web-side` branch. Its Resend key was the only real credential in it; the other values were placeholders and the database was `localhost`. Resend is no longer used (email is on Brevo), so **revoke that key at resend.com → API Keys**, and close the Resend account if nothing else uses it. Rewriting git history wouldn't help: the repository is public and may already have been cloned. Found by the Phase 5 full-history scan; `.gitleaksignore` records it.

## Suspected leak: what to do first

1. Rotate whatever leaked, starting with the **Critical** rows above.
2. If `JWT_SECRET` or the database leaked, also sign everyone out. Rotating `JWT_SECRET` does this for access tokens. To end refresh tokens as well, delete the `REFRESH` rows from `AuthToken`.
3. Check the admin audit log (Reports → Logs) for `REFRESH_TOKEN_REUSE`, unexpected admin logins and status changes.
4. If personal data may have been exposed, the Data Privacy Act gives **72 hours** to notify the National Privacy Commission (see the incident runbook, Security Phase 7).
