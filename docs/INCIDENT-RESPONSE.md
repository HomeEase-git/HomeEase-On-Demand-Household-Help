# Incident response

What to do when something goes wrong with security or personal data: a
leaked secret, a break-in, exposed documents, lost data. Work through the
steps in order; the playbooks at the end cover the likely cases.

**The clock:** if personal data may have been breached, the Data Privacy Act
rules give **72 hours from when you first know (or reasonably believe)** to
notify the National Privacy Commission (NPC) and the affected people, when
the breach must be reported (see *Notifying*). Write down the time you
found out. Don't wait for certainty before starting.

This repository is public: keep incident notes, evidence and names **out of
it**. Use a private note or document.

## Roles

HomeEase is run by one person, who holds every role below. Write the names
in here when that changes.

| Role | Who | Does |
|---|---|---|
| Incident lead | Owner | Runs the response, decides, keeps the log |
| Data Protection Officer (DPO) | Owner (`homeeaseondemand@gmail.com`, as in the Privacy Policy) | Decides on and sends NPC and user notifications |
| Backup contact | The owner's personal account (address in the password manager). Add a second, trusted person when there is one | If the HomeEase account is unusable, or the owner is unreachable |

## Severity

| Level | Examples | Start within |
|---|---|---|
| **1: Critical** | Personal data exposed or taken (KYC documents, database); an attacker in an admin account or a production system; money moved without authorisation; production data destroyed | Immediately |
| **2: High** | A production secret leaked but no sign of use; a vulnerability that exposes data, not yet exploited; a `high` security alert you can't explain | Same day |
| **3: Low** | A single failed attack; a leaked low-risk key (e.g. Sentry DSN); a vulnerability with little impact | Within a week |

Security alerts arrive by email and in the audit log
([MONITORING.md](MONITORING.md) explains each alert type).

## Steps

### 1. Record
Start a private incident note: when and how you found out, what you know,
and each action with its time (UTC and Philippine time). Keep adding to it.

### 2. Contain: stop it getting worse
Pick the playbook below. Typical moves: rotate the leaked secret, suspend
the account, take a bucket private, turn off the feature. Containing comes
before investigating, but **don't delete evidence**: logs, audit entries,
the attacker's account.

### 3. Preserve evidence
- Render → Logs: download the time window, before it rolls off.
- Admin site → Reports → Logs: note or screenshot the relevant audit
  entries (category SECURITY and ADMIN_ACTION first).
- For data changes: a Neon branch at a time before the incident
  ([DATA-RESILIENCE.md](DATA-RESILIENCE.md), restoring A) keeps the
  "before" state.
- Supabase, Xendit, GitHub and Neon each have their own activity logs;
  export what's relevant.

### 4. Assess: is it a personal data breach?
Answer, and write down:
- **What data**: which fields and files? Does it include *sensitive
  personal information* (government IDs, selfies, clearances, TINs, health
  certificates) or anything that allows identity fraud (ID + name + date of
  birth, payout accounts)?
- **Whose, and how many** people?
- **Was it actually accessed or taken** by someone not authorised, or just
  exposed? Encrypted data (TINs, payout numbers, backups) whose key did
  **not** leak is much lower risk.
- **Could it cause real harm**: identity theft, fraud, discrimination,
  physical risk (home addresses)?

### 5. Notify (if required)
See *Notifying*. Also tell Xendit if payments are involved, and Google
(Play Console) if the app itself was affected.

### 6. Fix and recover
Close the hole (code fix, setting change), restore damaged data
([DATA-RESILIENCE.md](DATA-RESILIENCE.md)), and confirm nothing else was
touched. Rotate anything the attacker could have seen.

### 7. Review (within two weeks)
Write a short blameless summary in the private note: timeline, cause, what
worked, what didn't, and the changes that stop it recurring. Turn those into
issues or pull requests. Record the incident in the yearly incident summary
(see *Notifying*).

## Notifying

The rules are the Data Privacy Act (RA 10173), its Implementing Rules, and
the NPC's circular on personal data breach management (NPC Circular 16-03
as of this writing). **Check privacy.gov.ph for the current circular and
form before notifying**; if in doubt, notify.

**Notify the NPC and the affected people within 72 hours when all three are
true:**
1. the breach involves sensitive personal information, or information that
   could enable identity fraud;
2. the data was, or is reasonably believed to have been, acquired by an
   unauthorised person; and
3. it's likely to give rise to a real risk of serious harm to the people
   affected.

A leak of KYC documents almost always meets all three. If you're still
investigating at 72 hours, notify with what you know and follow up.

**What the NPC notification includes:** what happened and when you found
out; the personal data involved and roughly how many people; the likely
consequences; what you've done and will do to contain it and reduce harm;
the DPO's contact details. Use the NPC's breach notification system on
privacy.gov.ph.

**What to tell affected people** (email, and in-app notification if the app
still works), in plain words:
- what happened and when, and what data of theirs was involved;
- what we've done about it;
- what they should do (e.g. watch for scam calls using their details,
  change their password if they reuse it elsewhere);
- who to contact: the DPO email.

Don't put more personal data in the notice than needed, and send it
individually, not as one email with everyone in the To line.

**Every incident**, notified or not, goes in the private incident log.
Personal information controllers also report their security incidents to
the NPC in a yearly summary; check the current deadline and form on
privacy.gov.ph each January.

## Playbooks

### A secret leaked (committed, pasted, laptop lost)
Follow [SECRETS.md](SECRETS.md) → *Suspected leak: what to do first*: rotate
first, then check the provider's logs for use. Severity 2, or 1 if it was
used.

### An admin account may be compromised
(Unexplained admin actions, an `ADMIN_*` or `LOGIN_LOCKOUT` alert for an
admin, a sign-in you don't recognise.)
1. **End the attacker's session first.**
   - If you can still sign in: change the password from a trusted device.
     That signs out every other device at once (their refresh tokens are
     deleted and their access tokens revoked).
   - If you can't: from another admin account, suspend the account (Users →
     the admin → Suspend), which ends all its sessions at once. With no
     other admin, rotate `JWT_SECRET` on Render (ends every access token once
     it redeploys) and, with the owner connection, delete that account's
     refresh tokens:
   ```sql
   DELETE FROM "AuthToken" WHERE type = 'REFRESH';                         -- everyone
   DELETE FROM "AuthToken" WHERE type = 'REFRESH' AND "userId" = '<id>';  -- one account
   ```
   - Don't rely on `scripts/reset-admin-mfa.ts` for this: it deletes refresh
     tokens only, so an access token already issued keeps working for up to
     15 minutes.
2. Then from a trusted device: set a new password, reset MFA
   (`scripts/reset-admin-mfa.ts`, [DEPLOY.md](../DEPLOY.md)) and enrol a new
   authenticator. Reinstate the account if you suspended it.
3. Audit log (Reports → Logs): list everything that account did since the
   earliest suspicious moment: approvals, refunds, payouts, price changes,
   user changes, document views. Undo what's wrong.
4. If it viewed or exported KYC documents or payout details: assess as a
   personal data breach (step 4).

### KYC documents or other files exposed
(A bucket made public, a signed link shared widely, the Supabase service or
S3 key leaked.)
1. Make the bucket private again and rotate `SUPABASE_SERVICE_KEY` and the
   Supabase S3 key ([SECRETS.md](SECRETS.md)).
2. Check Supabase's logs for which files were fetched, and by whom.
3. Government IDs and selfies are sensitive personal information: this is
   almost certainly **notifiable**. Start the 72-hour notification.

### Database contents exposed or taken
(A database password leaked and used, an injection flaw exploited, a dump
left somewhere public.)
1. Rotate the owner, `homeease_app` and `homeease_readonly` passwords
   ([SECRETS.md](SECRETS.md) → *Database password*) and anything else stored
   in the database. Then sign everyone out: rotating `JWT_SECRET` only ends
   access tokens (apps renew them with their refresh token), so also delete
   every refresh token with the owner connection:
   ```sql
   DELETE FROM "AuthToken" WHERE type = 'REFRESH';                         -- everyone
   DELETE FROM "AuthToken" WHERE type = 'REFRESH' AND "userId" = '<id>';  -- one account
   ```
2. Assume every table was read unless logs prove otherwise. TINs and payout
   numbers are encrypted: they're safe only if `DATA_ENCRYPTION_KEY` did not
   leak too.
3. Assess and notify (steps 4-5).

### Data deleted or corrupted
Contain the cause (stop the script, roll back the deploy), then restore:
[DATA-RESILIENCE.md](DATA-RESILIENCE.md) → *Restoring*. Lost personal data
can itself be a reportable breach: assess it.

### Payment fraud or fake payment notices
(`XENDIT_WEBHOOK_*` alerts, bookings marked paid with no money in Xendit,
unexpected payouts.)
1. Rotate `XENDIT_WEBHOOK_TOKEN` (and `XENDIT_SECRET_KEY` if payouts moved)
   per [SECRETS.md](SECRETS.md).
2. Compare Xendit's transaction list with the ledger (admin site →
   Payments → Books & reconciliation). Hold payouts for affected bookings.
3. Contact Xendit support; they can trace and sometimes reverse.

### A vulnerability report arrives
Acknowledge it within the times in [SECURITY.md](../SECURITY.md), reproduce
it with test accounts, and fix it within the target for its severity. If
the reporter reached real personal data, treat it as an incident and assess
it (step 4).

### The service is down
[MONITORING.md](MONITORING.md) (uptime) and Render's status. Not a security
incident unless an attack caused it.

## Practice

Once a year, take one playbook and walk through it on paper (who, what,
which commands, where the credentials are) with a timer. Fix whatever was
slow or missing. The quarterly restore drill is already the practice run
for lost data.
