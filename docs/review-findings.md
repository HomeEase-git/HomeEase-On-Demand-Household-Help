# HomeEase review findings

Date: 2026-10-07. This is a read-only review. No code was changed and no tests were run. Severities are my own judgement. Line numbers refer to commit `6d699e7b`.

## 1. Architecture summary

**Units.** There is no root package. Each unit has its own npm project.

- **backend/**: Express 5 + TypeScript, Prisma 7 on Neon Postgres, BullMQ on Redis, and Socket.IO. It is deployed to Render as one process.
  - `src/index.ts` boots the HTTP server, the socket server and three BullMQ workers (booking, payout, verification) in the same process.
  - Requests flow `routes/` (validation, `auth`, `restrictTo`) → `controllers/` → `services/` → Prisma.
  - `protectResponseData` rewrites every JSON response. It signs private Supabase URLs and masks encrypted fields.
  - Money is handled in three places:
    - a double-entry ledger in integer centavos (`ledgerService.ts`)
    - Xendit invoices for payments, and Xendit disbursements for payouts
    - webhooks in `routes/payments.ts`
  - Booking status rules live in `bookingStateMachine.ts`.
  - Sweeps (timeouts, no-shows, reconciliation, retention) run in two ways: as BullMQ repeatable jobs, and through `POST /internal/cron/:task`, which GitHub Actions calls because the free Render instance sleeps.
  - Size: 97 migrations and a 2577-line schema. The largest files are `bookingController.ts` (3309 lines), `workerController.ts` (2858) and `authController.ts` (1447).
- **mobile/**: one Expo / expo-router app for both clients and workers.
  - Route groups: `(auth)`, `(onboarding)`, `(kyc)`, `(client)`, `(worker)`.
  - `services/api.ts` (2763 lines) is the axios layer, with single-flight token refresh. Tokens are kept in SecureStore.
  - Zustand stores hold app state. Socket.IO carries realtime updates and refetches on reconnect.
  - `shared/` is not used.
- **web/**: the Vite + React 19 admin dashboard, deployed to Vercel.
  - It uses HashRouter. `AuthContext` and `ProtectedRoute` require the `ADMIN` role.
  - Login has an MFA challenge step. Idle sign-out is shared across tabs.
  - A CSP meta tag is added at build time.
  - There are no tests and no lint.
- **shared/**: a fetch-based API client, browser token storage and enum constants. Only web imports it.

**Strengths worth keeping:**
- Ownership checks on every user-facing handler that was reviewed.
- Constant-time secret comparison on webhooks and `/internal/*`.
- Refresh-token rotation with reuse detection.
- Guarded `updateMany` claims for payouts.
- An idempotent integer ledger.
- A least-privilege DB role in CI and production.
- Startup refuses missing or placeholder secrets.

## 2. Biggest risks, ranked

### High

1. **Private-file signing works as an oracle.** Files: `backend/src/utils/storageUrls.ts:144-176`, applied by `middleware/protectResponseData.ts`.
   - The response layer signs *any* string that looks like a private-bucket URL, including free text such as chat `content`. It never checks who owns the file.
   - A user who knows or once saw a KYC/resume path can paste it into a message and get a fresh 1-hour signed URL to another user's ID document.
   - Fix: sign only known URL fields, or check the path against the caller's permissions.

2. **Booking status changes can race.** The state machine checks a status read earlier in the request, then writes with `update({ where: { id } })`. The write has no status condition and no row lock.
   - Examples: accept at `bookingController.ts:1167`/`:1232`, start at `:1689`/`:1697`, approve quote at `:2339`/`:2348`, cancel at `:2855`/`:2996`.
   - The pending-expiry worker does the same at `workers/bookingWorker.ts:72`/`:75`. So do the admin cancel, dispute resolution, and `paymentLifecycleService.ts:193,577,653`.
   - Scenario: the expiry job and Accept fire at the same moment. The booking ends up CANCELLED with `acceptedAt` set.
   - Fix: write with `updateMany({ where: { id, status: expected } })` and check the count.

3. **A payout can get stuck in PROCESSING forever.** File: `workers/payoutWorker.ts:36-59`.
   - The worker claims PENDING→PROCESSING first and stores `xenditDisbursementId` only after the Xendit call.
   - If the process dies between those two steps (deploy, OOM, crash), the payout cannot recover:
     - A retry exits early because the status is not PENDING.
     - Reconciliation only looks at rows that have a disbursement id.
     - Re-enqueue only looks at PENDING rows.
   - The worker is never paid, and account deletion is blocked (`accountDeletionService.ts:49`).

4. **Retrying a failed payout probably does nothing.** Files: `queues/payoutQueue.ts:37-41`, `adminPaymentController.ts:303-318`.
   - The job id is fixed per payout and failed jobs are kept (`removeOnFail: false`). BullMQ silently ignores a job whose id already exists.
   - A resend would also reuse the same Xendit idempotency key (`payout.id`).
   - The admin sees "re-queued" while nothing is sent.

5. **A short Redis blip permanently kills the queue producers.** File: `config/redis.ts:41-45`.
   - `queueConnection.retryStrategy` returns `null` after 3 tries, and ioredis then stops reconnecting for good. `bookingQueue` and `payoutQueue` share this connection.
   - The Render health check hits `/health`, which does not check Redis, so the process is never restarted.
   - Result: payouts and pending-expiry scheduling fail until the next deploy.

6. **Mobile: any 403 logs the user out.** File: `mobile/services/api.ts:160-189`.
   - The client treats 403 like 401: it clears the tokens and jumps to `/landing`.
   - The backend uses 403 for ordinary business rules, for example `bookingController.ts:1164`, `:427` and `:1184` (`WORKER_SETUP_INCOMPLETE`).
   - Scenario: a worker who hasn't finished setup taps Accept and is signed out.

7. **Mobile: the route groups don't check role.** Files: `mobile/app/(worker)/_layout.tsx:23`, `mobile/app/(client)/_layout.tsx:21`.
   - The worker layout only redirects users who are workers without KYC approval. A client, or a signed-out user, falls through and gets the worker tabs (for example via a deep link). The client layout has the same gap the other way round.
   - Combined with #6, this leads to a logout loop.

### Medium

8. **The server does not enforce admin MFA.** Files: `authController.ts:333, 1216`, `middleware/role.ts`.
   - An admin without MFA gets a full session from the password alone. `mfaSetupRequired` is only a hint to the client.
   - **Related risk:** `prisma/seeds/seed-e2e-sandbox.ts` creates an ADMIN with the committed password `E2eAdminPass123!` and has no guard against running on production.
9. **A stored refresh-token hash works as a token.** File: `utils/otpService.ts:85` (`{ in: [hash(token), token] }`, kept for old plaintext tokens). A DB backup or read access is enough to mint sessions. Drop the plaintext branch.
10. **Payment webhooks trust the request body.** Files: `paymentController.ts` ~445-458, `paymentLifecycleService.ts:551`.
    - The only check is a static shared token. The invoice is not re-fetched from Xendit.
    - The underpayment check is skipped when `paid_amount` is missing.
    - Fix: re-fetch the invoice with `retrieveInvoice` before settling.
11. **Money is stored as `Float` outside the ledger.** File: `prisma/schema.prisma`, 92 Float fields, including `Payment.*` (1848-1874), `Payout.amount` (1971), `DebtLedgerEntry` (2033-2034) and the tax-period totals.
    - Only `LedgerLine.amountCentavos` is an integer.
    - Expect centavo drift between reports and the ledger.
12. **Migrations run on every boot, and some are destructive.** Files: `docker-entrypoint.sh`, `render.yaml` (`RUN_MIGRATIONS: "true"`). 9 of the 97 migrations drop tables or columns. There is no rollback, and old instances break while the new one migrates.
13. **Deleting a user cascades into money records.** In `schema.prisma`, User→Booking→Payment→Payout/RefundRequest and WorkerProfile→DebtLedgerEntry all use `onDelete: Cascade`. App code anonymises users instead of deleting them, but one manual `DELETE` would wipe BIR-relevant history. Use `Restrict`.
14. **Safety checks are skipped when Redis is down.** Files: `utils/otpAttemptLimiter.ts:90-99`, `utils/tokenRevocation.ts:460-470`. During an outage, OTP/MFA guessing has no per-account limit and revoked sessions keep working for up to 15 minutes. This is documented, but it overlaps with #5.
15. **Admin tokens are stored in localStorage.** File: `shared/api-client/storage-browser.js:3-33`. Any XSS can steal a long-lived refresh token. The CSP is only a build-time meta tag, and `web/vercel.json` sends no `script-src` header.
16. **Test gaps.**
    - Backend: no tests for `messageController`, `uploadController`, `socket.ts`, `verificationWorker`, cancel/expiry, the auto-approve sweeps, or dispute escalation, and no race tests for #2.
    - Mobile: no tests for `api.ts`, `authStore`, `socket`, the layouts or any screen.
    - Web: none.

### Low

- The ledger credits the worker with `captured − commission − tax`, but the payout uses `workerPayout`. An overpayment therefore overstates `WORKER_BALANCE` (`ledgerService.ts:133,148`).
- MFA backup codes can be used twice under concurrency, and TOTP codes can be replayed within their window (`mfaService.ts:111-115`).
- Login OTPs are stored in plaintext (`otpService.ts:27-33`).
- The Xendit disbursement HTTP client has no timeout.
- Chat, avatar and booking-photo uploads trust the client-declared MIME type (`uploadController.ts:52-58`).
- JWT verification doesn't pin `algorithms: ['HS256']` (`utils/jwt.ts`).
- The `/internal/cron/all` sweep (14 tasks one after another) can exceed the workflow's `curl --max-time 120`, which makes the workflow fail spuriously.
- Account deletion leaves `SavedPaymentMethod` rows and the payout account name and number in place, and isn't atomic (`accountDeletionService.ts:116-178`).
- Mobile:
  - Push registration is skipped after switching accounts (`hooks/usePushNotificationPrompt.ts:5`).
  - Logout leaves the booking draft and caches for the next user (`store/authStore.ts:94-120`).
  - Full error bodies are logged in production builds (`services/api.ts:124-129`).
  - `offline-sync.ts` is dead code with no idempotency.
- Repo hygiene:
  - `mobile/coverage/` and `mobile/expo-log.txt` are committed even though `.gitignore` covers them. The log contains a local user path.
  - The backend root `_probe*.js` / `_fix_*.js` / `_e2e_test_run.js` scripts are committed. `_probe.js` prints admin emails.
- The `USER_STATUS` / `VERIFICATION_STATUS` enums in `shared/constants/index.js` have drifted from Prisma. They are currently unused.
- Dependencies: `@prisma/client ^7.8` vs `prisma ^7.9`, and `ts-jest ^29` with `jest ^30` / `typescript ^6`. `docker-compose.yml` exposes Postgres `5432` with a default password. The Redis `ipAllowList` in `render.yaml` is `0.0.0.0/0`.

## 3. Suggested order of work

1. Fix the signed-URL oracle (#1).
2. Make status writes conditional (#2).
3. Fix the payout recovery and retry paths (#3, #4) and the Redis reconnect (#5).
4. Fix the mobile 403 handling and role gates (#6, #7).
5. Enforce admin MFA on the server and guard the e2e seed (#8).
6. Drop the plaintext refresh-token match (#9) and re-fetch invoices in the webhook (#10).
7. Plan the Float→centavo migration, the cascade→restrict change, and expand/contract migrations (#11-13).
