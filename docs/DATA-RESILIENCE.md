# Data resilience: backups, restore, retention and database access

Where HomeEase's data lives, how to get it back after a mistake or an outage,
how long each kind of data is kept, and which database login may do what.

## Where the data is, and what protects it

| Store | Holds | Protection today |
|---|---|---|
| **Neon Postgres** (project `homeease-prod`) | Everything structured: accounts, bookings, payments, ledger, audit log, chat text | Neon keeps every change for a restore window and can rebuild the database as it was at any moment inside it. The window is **6 hours** on the Free plan (Neon console → project → Settings → Storage / history retention shows the current value). Neon replicates storage across availability zones, so a single disk or server failure loses nothing |
| **Supabase Storage** | Files: KYC IDs and selfies, resumes, certifications, chat images, avatars, booking photos, tax certificates | Supabase itself keeps no backup of these files. The nightly off-site backup copies every bucket |
| **Off-site backup** (Backblaze B2, see below) | An encrypted copy of the database and of every file, made each night, kept 30 days | Separate provider and account from Neon and Supabase; only the private key in the password manager can read it |
| **Redis** (Render Key Value) | Rate-limit and login-lockout counters, session revocations, the job queue | Nothing to back up. If it's wiped: counters restart at zero; repeating jobs are re-registered at the next boot; the hourly cron backstop re-runs every sweep, including expiring overdue pending bookings. Access-token revocations ("log out everywhere", suspensions) are forgotten, so a revoked access token works again until it expires: 15 minutes once `JWT_EXPIRY` is 900. Refresh tokens are in Postgres and stay revoked |
| **Secrets** | Render, Vercel and EAS settings; password manager | See [SECRETS.md](SECRETS.md). A backup is useless without `DATA_ENCRYPTION_KEY` and `MFA_ENCRYPTION_KEY`: the values they encrypted can't be read |

**Recovery targets.** Inside Neon's window, the database can be put back to
any second (recovery point: the moment before the damage). A restored branch
is ready in well under a minute; switching the app to it takes one Render
redeploy. The quarterly drill measures the real time. Damage noticed only
**after** that window can still be undone from the off-site backup, to the
state of any of the last 30 nights (anything since that night is lost).

## Restoring

First, find **T**: a moment just before the damage. Use the audit log (admin
site → Reports → Logs), Render's logs, or the time the bad script or deploy ran.
Neon times are UTC; the Philippines is UTC+8.

### A. Some rows were wrongly changed or deleted (a bad script, a bug)

Bring back only what was damaged. Everything else, including payments made
since, stays as it is.

1. Make a copy of the database as it was at T. Neon console → project → **Branches → Create branch**, choose **Past data** and T. Or from `backend/`: `npx -y neonctl@6.3.0 branches create --project-id <id> --name fix-<date> --parent <T as 2026-01-31T13:45:00Z>`.
2. Check the copy (read-only; prints counts, not data):
   `npx tsx scripts/restore-drill.ts --verify-only "<branch connection string>" --as-of <T>`
3. Copy the affected rows from the branch into production. Write the SQL against the branch first, have it produce exactly the rows you expect, then run the insert or update on production inside a transaction. Never copy whole tables back: that would erase everything since T.
4. Delete the branch.

### B. The whole database is wrong (a destructive migration, mass corruption)

1. Neon console → Branches → the production branch → **Restore** → to T.
   The connection strings don't change, so Render needs no change. Neon keeps
   the state from before the restore as a backup branch, in case T was wrong.
2. Check it: `npx tsx scripts/restore-drill.ts --verify-only "<DIRECT_URL>" --as-of <T>`.
3. **Everything after T is gone**: sign-ups, bookings, messages, and payment
   records. Money isn't: it moved in Xendit. In the Xendit dashboard, list
   invoices and payouts since T and match each one to a booking. A payment
   that was already pending at T is caught by the hourly sweep, which asks
   Xendit about pending payments; one created after T has no record left and
   must be matched by hand. Tell affected
   users. Under the Data Privacy Act, losing personal data can be a
   reportable breach; follow the incident runbook (governance phase).
4. Record what happened and why, and what changes so it can't recur.

### C. Older damage, lost files, or Neon/Supabase unavailable

Use the off-site backup (below): *Getting a backup back*. It restores the
database and files as they were on a chosen night; everything after that
night is lost, as in B. For a Neon outage, wait for Neon first unless it's
long: restoring elsewhere means a new database and a new `DATABASE_URL`.

## Restore drill (every quarter)

A backup that has never been restored is a hope, not a backup. The
**Restore drill** workflow (`.github/workflows/restore-drill.yml`, runs
1 Jan, 1 Apr, 1 Jul and 1 Oct) restores production as it was an hour ago into
a temporary Neon branch, checks the copy, and deletes it. The checks
(`backend/scripts/restore-drill.ts`):

| Check | Fails when |
|---|---|
| Migration history | A migration is half-applied |
| Point in time | Any `createdAt` or `updatedAt` in any table is later than the requested moment, so it isn't the restore that was asked for |
| Data present | No user accounts |
| Constraints and indexes | Any constraint or index is invalid |
| Ledger balances | Any double-entry transaction doesn't balance |
| Encrypted fields, MFA secrets | A sampled value doesn't decrypt with the current key (skipped unless the keys are given to the run) |

It also reports how long the restore took and the row count of every table.
It never prints row contents. The branch expires by itself after 6 hours if
the run dies before deleting it.

**Setting it up (once):**
1. Neon console → organization/account settings → **API keys** → create a key.
   If Neon offers a key limited to one project, limit it to `homeease-prod`.
2. GitHub → repository → Settings → Secrets and variables → Actions:
   secret `NEON_API_KEY` = that key; variable `NEON_PROJECT_ID` = `quiet-pond-70953688`.
3. Actions → **Restore drill** → Run workflow. It should finish green in a few minutes.

The key can create and delete branches and read the production database, so
it lives only in GitHub's secrets, and only this workflow (never pull-request
runs) receives it. If it leaks, delete it in Neon and create a new one
([SECRETS.md](SECRETS.md)). Adding `DATA_ENCRYPTION_KEY` and
`MFA_ENCRYPTION_KEY` as GitHub secrets turns on the decryption checks, but
puts two more production secrets in GitHub. The alternative is running the
drill yourself once a year with the keys in your shell:
`NEON_API_KEY=… DATA_ENCRYPTION_KEY=… MFA_ENCRYPTION_KEY=… npx tsx scripts/restore-drill.ts --project-id quiet-pond-70953688 --neon-websocket`
(`--neon-websocket` because this office network blocks direct Postgres
connections to Neon; see the script header for the one-off install it needs).

Until the secret is set, each quarterly run fails with a message saying so,
which works as the reminder.

**Drill log:** add a line after each drill.

| Date | Result | Restore time | Notes |
|---|---|---|---|
| 2026-09-29 | ✅ Pass ([run](https://github.com/HomeEase-git/HomeEase-On-Demand-Household-Help/actions/runs/36565675185)) | 11 s to a queryable copy; 23 s including checks | Restored to 1 h before; 17 users, 2,925 rows, 54 tables; ledger balanced. Decryption checks skipped (keys not in GitHub). First run of the Neon branch path |

## Off-site backup (every night)

`.github/workflows/offsite-backup.yml` runs `backend/scripts/offsite-backup.sh`
at 02:17 Philippine time:
1. Dumps the database as `homeease_readonly`, restores the dump into a
   scratch database on the GitHub runner, and runs the restore-drill checks
   on it. A copy that doesn't restore fails the run and isn't uploaded.
2. Copies every Supabase Storage bucket.
3. Encrypts both with [age](https://age-encryption.org) to your public key
   and uploads them to Backblaze B2 as `<date and time>/db.dump.age`,
   `files.tar.age` and `SHA256SUMS`. A folder without `SHA256SUMS` is an
   incomplete run.

Nothing unencrypted leaves the runner. The upload key can only write: it
can't read, list or delete backups, so a leaked key exposes nothing and
can't wipe them. Every pull request that changes the backup runs the full
backup and restore against throwaway services first (`self-test` job). A
failed run is only noticed if GitHub tells you: check GitHub → Settings →
Notifications → **Actions** has email on for failed workflows. GitHub sends
a scheduled run's failure to the account that last changed its schedule
(the one that merged this workflow). The same applies to the restore drill.

Copies leave the Philippines (B2 has no Asian region; Neon is in
Singapore). The Data Privacy Act allows this with the same protection; the
Privacy Policy should say personal data is stored with providers abroad
(governance phase).

### Setting it up (once, about 30 minutes)

**1. Encryption key.** In PowerShell: `winget install FiloSottile.age`, open
a new window, then `age-keygen -o homeease-backup-key.txt`. It prints the
**public key** (`age1…`). Store the whole file's contents as a secure note in
the password manager, and a second copy offline (printed, or on a USB stick
kept somewhere safe): **without this key no backup can ever be read.** Then
delete the file.

**2. Backblaze B2** (backblaze.com, B2 Cloud Storage; free up to 10 GB):
- Create a bucket, e.g. `homeease-backups`: **Private**. Turn on **Object
  Lock** with a default retention of 30 days, so nobody, not even your own
  account, can delete a copy before it's 30 days old.
- Bucket → **Lifecycle Settings** → custom: hide files 30 days after upload,
  delete 1 day after hiding. That keeps 30 nights.
- **Application Keys → Add a New Application Key**: only this bucket, type
  **Write Only**. Note the keyID and applicationKey (shown once).
- The bucket page shows the S3 endpoint, e.g. `s3.us-west-004.backblazeb2.com`;
  the region is the middle part (`us-west-004`).

**3. Supabase file access.** Supabase → project → Project Settings →
Storage → **S3 Connection**: enable it, note the endpoint and region, and
create an access key. It can read and write every bucket, so it lives only in
GitHub's secrets.

**4. GitHub** (Settings → Secrets and variables → Actions), or with
`gh secret set NAME` / `gh variable set NAME --body VALUE`:

| Kind | Name | Value |
|---|---|---|
| Secret | `BACKUP_DATABASE_URL` | The `homeease_readonly` **direct** string (host without `-pooler`) with its password |
| Secret | `OFFSITE_ACCESS_KEY_ID` / `OFFSITE_SECRET_ACCESS_KEY` | B2 keyID / applicationKey |
| Secret | `SUPABASE_S3_ACCESS_KEY_ID` / `SUPABASE_S3_SECRET_ACCESS_KEY` | Supabase S3 access key |
| Variable | `AGE_RECIPIENT` | The public key, `age1…` |
| Variable | `OFFSITE_ENDPOINT` | `https://s3.<region>.backblazeb2.com` |
| Variable | `OFFSITE_REGION` | e.g. `us-west-004` |
| Variable | `OFFSITE_BUCKET` | e.g. `homeease-backups` |
| Variable | `SUPABASE_S3_ENDPOINT` | From step 3, e.g. `https://<project>.storage.supabase.co/storage/v1/s3` |
| Variable | `SUPABASE_S3_REGION` | From step 3 |

**5. Failure emails:** GitHub → your avatar → Settings → Notifications →
**Actions**: email on, "Only notify for failed workflows" on.

**6. First run:** Actions → **Off-site backup** → Run workflow. Check the
summary (database size, files per bucket), then do the recovery test below
once, so you know your key works.

### Getting a backup back

1. In B2, create a temporary **Read Only** key for the bucket.
2. Save the private key from the password manager to a file, e.g. `key.txt`.
3. From `backend/` in Git Bash (needs `age`, the AWS CLI and PostgreSQL 18's
   `pg_restore`; `OFFSITE_*` as in the table, with the read key):
   `bash scripts/offsite-restore.sh latest key.txt restored`
   (or a folder name instead of `latest`). It checks the files against
   `SHA256SUMS`, decrypts, and leaves `restored/db.dump` and
   `restored/files/<bucket>/…`.
4. Database: create an empty database (a new Neon branch or project), then
   `pg_restore --no-owner --no-privileges --dbname "<its URL>" restored/db.dump`,
   or add `--restore-db "<its URL>"` to step 3. Check it with
   `npx tsx scripts/restore-drill.ts --verify-only "<its URL>"`, then run
   `scripts/db-roles.ts` on it before pointing the app at it.
5. Files: upload a bucket back with the AWS CLI against the Supabase S3
   endpoint, e.g.
   `aws s3 sync restored/files/kyc-documents s3://kyc-documents --endpoint-url <SUPABASE_S3_ENDPOINT>`.
6. Delete `key.txt`, the `restored` folder and the temporary B2 key.

## Retention schedule

Personal data is kept only as long as needed (Data Privacy Act §11(e)).
Automatic deletions run daily (booking queue, 03:40 server time) and hourly
from the cron backstop (task `purge-expired-data`); see
`backend/src/services/dataRetentionService.ts`.

| Data | Kept | Then | How |
|---|---|---|---|
| Sign-in codes, reset links, refresh tokens | Until they expire, plus 1 day | Deleted | `purge-expired-data` |
| Used refresh tokens (theft detection) | 24 hours after use | Deleted | On that device's next refresh |
| Worker live location | Only while travelling to a job; at most 2 hours after the last update | Cleared | `clear-stale-locations`, hourly |
| Notifications | Once read, until 180 days old; unread, until 365 days old | Deleted | `purge-expired-data` |
| Sign-in audit entries (logins, failed logins, MFA; they hold emails and names, including of people with no account) | 365 days | Deleted | `purge_expired_login_audit()`, database function |
| Other audit entries (admin actions, security alerts, status changes, errors) | Kept | — | Can't be edited or deleted by the app |
| Account and profile data, ID/selfie/clearance/certification/resume files | While the account is active | Erased on account deletion | `accountDeletionService.ts` |
| Bookings, payments, payouts, ledger, tax certificates | For the period tax and accounting law requires (confirm with the accountant) | Name removed on account deletion; records kept | Not deleted automatically |
| Chat messages | Kept: they're the other person's record too | Images removed on account deletion | `accountDeletionService.ts` |
| Contract and consent acceptances | Kept: proof of consent | — | — |
| Database restore history | Neon's window (6 hours on Free) | Rolls off | Neon |
| Off-site backups (database and files) | 30 nights | Deleted | B2 lifecycle rule; Object Lock blocks earlier deletion |
| Server logs, error reports | The hosting plan's retention (Render, Sentry) | Rolls off | Provider |

The Privacy Policy (section 6, "How long we keep it") covers the first rows
it lists; everything here is kept no longer than it says. Notifications and
sign-in records aren't named there yet: add them at the next policy update.

## Database roles

The app should sign in to the database with only the rights it needs, so a
bug or an injection in the app can't drop a table, change the schema or
rewrite the audit trail or the books.

| Login | Used by | Can | Can't |
|---|---|---|---|
| Owner (`neondb_owner`) | `DIRECT_URL`: migrations at container start, scripts | Everything | — |
| `homeease_app` | `DATABASE_URL`: the running server | Read and write rows in app tables; add (never edit or delete) audit log, ledger, worker debt history and price calculation entries; run the sign-in audit purge. Queries stop after 60s | Create, alter or drop tables; edit or delete those records; read or touch migration history |
| `homeease_readonly` | Reports, exports, investigations, `--verify-only` | Read every table | Change anything (every session is read-only) |

`scripts/db-roles.ts` creates both roles and applies the grants. It's
idempotent and prints a pass/fail line for each rule. Every table must be
listed in the script as `APPEND_ONLY` (insert-only) or `READ_WRITE`: a
migration that adds a table fails CI until someone decides which. New tables
still get read/write rights automatically in production, so a deploy never
breaks because the script wasn't re-run. CI creates the roles on
every run and runs the whole test suite as `homeease_app`, so a change that
needs more rights fails before merge. Always create these roles with the
script: roles made in the Neon console join `neon_superuser`, which defeats
the point.

**Switching production to `homeease_app` (once, about 10 minutes):**
1. In the password manager, create two entries, "HomeEase DB homeease_app"
   and "HomeEase DB homeease_readonly", each with a generated password
   (letters and digits only, 32+ characters; or `openssl rand -hex 24`).
   The script never makes up or prints a password: you supply them.
2. From `backend/` in Git Bash, enter the passwords without them landing in
   shell history: `read -rs APP_DB_PASSWORD && read -rs READONLY_DB_PASSWORD && export APP_DB_PASSWORD READONLY_DB_PASSWORD`
   (paste each, press Enter; nothing is shown). Then, with the production
   **owner** connection string:
   `DIRECT_URL="<owner direct URL>" npx tsx scripts/db-roles.ts --neon-websocket`
   (drop `--neon-websocket` on a network that allows Postgres connections).
   All lines should say `ok`. It prints each role's connection strings with
   `PASSWORD` in place of the password.
3. Render → backend → Environment: set `DATABASE_URL` to the **pooled**
   `homeease_app` string, with `PASSWORD` replaced by the real one. Leave
   `DIRECT_URL` as it is: migrations need the owner. Save; Render redeploys.
4. Check: `/health/ready` is ready, you can sign in to the admin site, and
   the Render log has **no** `Config warning: DATABASE_URL signs in as …` line.
   Until this switch, that warning appears on every start.

To undo, put the previous `DATABASE_URL` back. To change a role's password,
generate a new one, then
`APP_DB_PASSWORD="<new>" npx tsx scripts/db-roles.ts --rotate homeease_app`
(`READONLY_DB_PASSWORD` and `homeease_readonly` for the other role),
then update Render. After deploying a migration that adds an `APPEND_ONLY`
table, re-run the script against production to take away its edit rights.

## Known gaps

1. **Between the 6-hour window and last night.** Damage noticed more than 6
   hours later can only be undone to the previous nightly backup, losing
   that day's changes. A paid Neon plan with a longer restore window would
   close this if that ever becomes unacceptable.
2. **Files are backed up nightly, not live.** A file uploaded and then lost
   the same day isn't in any backup.
3. **The owner login is still on Render** (`DIRECT_URL`), because the
   container runs migrations when it starts. Moving migrations into a
   separate deploy step would take it off the running server.
