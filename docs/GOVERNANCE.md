# Security governance

How HomeEase keeps its security from decaying: who's responsible, what gets
checked and when, and which risks are knowingly open. Start here; the other
documents hold the detail.

## Documents

| Document | Covers |
|---|---|
| [SECURITY.md](../SECURITY.md) | How to report a vulnerability, response times, testing rules |
| [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) | What to do in an incident; 72-hour breach notification |
| [DATA-MAP.md](DATA-MAP.md) | What personal data we hold, where, and which providers receive it |
| [DATA-RESILIENCE.md](DATA-RESILIENCE.md) | Backups, restore, retention, database roles |
| [SECRETS.md](SECRETS.md) | Every credential, where it lives, how to rotate it |
| [MONITORING.md](MONITORING.md) | Security alerts, logs, uptime |
| [CI-SECURITY.md](CI-SECURITY.md) | Automated checks on every change |
| [DEPLOY.md](../DEPLOY.md) | Hosting, and the account-side production checklist |

## Responsibilities

The owner holds every role: security lead, Data Protection Officer (DPO,
reachable at the Privacy Policy's contact address), incident lead, and
admin of every service. Because one person holds everything:
- **Emergency access:** the password manager holds every credential and
  the backup private key. Arrange how a trusted person could get in if you
  can't (the password manager's emergency-access feature, or a sealed copy
  of its recovery details), and write their name in
  [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md#roles).
- **Service accounts use your own login with two-factor authentication:**
  GitHub, Render, Vercel, Neon, Supabase, Xendit, Backblaze, Google Cloud,
  Expo, Brevo, PhilSMS, Anthropic, and the Gmail account itself (it
  receives every password reset and alert).
- **Admin accounts in the app:** one per person, never shared, with MFA on.
  Remove an admin account the day its owner stops needing it.

When someone joins, give them their own accounts with the least access
their work needs, never the owner's credentials. When they leave, remove
those accounts and rotate any secret they could see ([SECRETS.md](SECRETS.md)).

## Security calendar

Automatic items email you when they fail (see *Failure emails* in
[DATA-RESILIENCE.md](DATA-RESILIENCE.md#setting-it-up-once-about-30-minutes)).
Keep the manual ones as recurring reminders in your calendar.

| When | What | How |
|---|---|---|
| Nightly (automatic) | Encrypted off-site backup, restored and checked first | `offsite-backup.yml` |
| Daily (automatic) | Retention purge; live-location clean-up hourly | Booking queue and cron backstop |
| Every change (automatic) | CodeQL, secret scan, dependency and container scans, full tests as the restricted database role | [CI-SECURITY.md](CI-SECURITY.md) |
| Weekly | Merge or close Dependabot pull requests; glance at security alert emails | GitHub; email |
| Monthly | GitHub → Security tab: new code-scanning or Dependabot alerts. Admin → Reports → Logs, category SECURITY: anything unexplained. Render logs: any `Config warning` lines | 15 minutes |
| Quarterly (1 Jan/Apr/Jul/Oct) | Restore drill runs itself; check it's green and log it. Access review: list admin accounts, API keys and GitHub collaborators; remove anything unneeded. Download one off-site backup and decrypt it with the private key | [DATA-RESILIENCE.md](DATA-RESILIENCE.md) |
| Yearly (January) | NPC yearly security incident summary (check current deadline and form at privacy.gov.ph). Rotate the long-lived secrets listed in [SECRETS.md](SECRETS.md). Re-read the Privacy Policy against [DATA-MAP.md](DATA-MAP.md). Walk through one incident playbook on paper. Review this file's risk register | Owner |
| On change | New outside service or new personal data → update DATA-MAP.md and the Privacy Policy (and bump its version) in the same pull request. New secret → SECRETS.md. New insert-only table → `scripts/db-roles.ts` | Pull request review |

## Risk register

Known, accepted-for-now risks. Review yearly and whenever one changes.
Close an entry when it's fixed; don't delete the history, strike it through.

| # | Risk | Impact | Status / plan |
|---|---|---|---|
| R1 | Access tokens on the live backend still last 7 days (`JWT_EXPIRY=604800`), because older app versions can't refresh | A stolen token works for up to 7 days | Open. New APK building 2026-09-30 (first build on the `production` update channel). Set `JWT_EXPIRY=900` on Render once it has replaced older installs |
| R2 | ~~A real Resend API key is in the repository's history (June 2026, branch `web-side`)~~ | Email could be sent as HomeEase | **Closed 2026-09-30:** key deleted in Resend. The value stays in history but no longer works |
| R3 | ~~No admin account has MFA enrolled in production (seen in the 2026-09-29 restore drill)~~ | A phished admin password is enough to take over | **Closed 2026-09-30:** MFA enabled on the admin account. Every new admin account must enrol too |
| R4 | The database owner login is on the running server (`DIRECT_URL`), because migrations run at container start | A server compromise can alter the schema | Accepted. Move migrations to a separate release step when the deploy setup allows |
| R5 | The Supabase S3 key in GitHub (for backups) can also write and delete files | A GitHub secrets leak could damage stored files | Accepted: only the backup job uses it, and pull requests from forks never receive secrets; B2 keeps 30 nights of files. Revisit if Supabase offers read-only S3 keys |
| R6 | Neon keeps 6 hours of history; the off-site backup is nightly | Damage found after 6 hours loses that day's changes | Accepted. A paid Neon plan with a longer window if that becomes unacceptable |
| R7 | One person holds every role and credential | Nobody can respond if the owner is unavailable | Partly addressed 2026-09-30: the owner's personal account is the fallback if the HomeEase account is unusable (address in the password manager, not here: this repository is public). Still open: a second, trusted person with emergency access |
| R8 | Legal terms await a Philippine lawyer's review; business registration details not yet in the app (Internet Transactions Act) | Terms may not hold as written; disclosure requirement unmet | Open, before public launch. See the TODO in `mobile/constants/legalDocuments.ts` |
| R9 | NPC registration of the DPO and processing systems not yet done | Non-compliance once registration thresholds are met | Open. Register when HomeEase processes sensitive personal information of 1,000 or more people (check current NPC thresholds) |
