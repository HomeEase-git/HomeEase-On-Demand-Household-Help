# Booking Process Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap found in the booking lifecycle review so that no booking can get stuck, no party is left without a way out, and every new action takes one or two taps.

**Architecture:** All rules live in the backend: new columns on `Booking`, three new worker/client endpoints, one extended endpoint, and one new 10-minute sweep. Shared cancel and compensation logic is pulled out of the existing controllers into two small services, so the new paths reuse it instead of copying it. The mobile app gets one client sheet ("Report a problem") and three worker controls, all driven by fields that `getBookingDetail` already returns or will return.

**Tech Stack:** Express 5 + TypeScript, Prisma 7 (Postgres), BullMQ, jest + supertest; Expo / React Native (expo-router, NativeWind).

**Spec:** No separate spec file. You chose to skip it, so the approved design (sections A–H, plus your two product answers) is reproduced below. Executors work from this section.

### Approved design

- **A.** A worker can cancel only while the booking is `ACCEPTED` or `IN_PROGRESS`. After the invoice is sent (`PENDING_COMPLETION`, `AWAITING_PAYMENT`, `DISPUTED`), only an admin can cancel, through the dispute action `CANCEL_BOOKING`.
- **B.** The client gets a **"Report a problem"** button from accepted until the invoice is sent. It opens one sheet with four reason chips, an optional note and a Send button.
  - `WORKER_NOT_HERE`:
    - Past the no-show deadline: the booking is cancelled at once as a worker no-show.
    - Before the deadline: the worker gets a push and SMS saying "your client is waiting".
    - Worker already checked in: the report becomes a dispute.
  - `WORKER_STOPPED` / `OTHER`: opens a dispute for an admin.
  - `NEED_TO_CANCEL`: a cancel request. The worker gets one-tap **Agree / Decline**.
    - Agree: free cancel, no penalty and no fee on either side.
    - Decline, or no answer within 2h (or by the booked start, whichever comes first): the request becomes a dispute for an admin.
- **C.** Worker checked in but hasn't started. The clock starts at `max(workerArrivedAt, booked start)`.
  - At +30 min: the worker gets a reminder to tap Start Job.
  - At +2h: the client gets a nudge pointing to Report a problem.
- **D.** Job stuck `IN_PROGRESS`. The clock starts at `max(workerStartedAt, latest non-cancelled visit start)`, and nothing fires while that is in the future.
  - At 12h: the worker gets a reminder to finish the job or schedule a follow-up.
  - At 48h: the client gets a nudge and admins are alerted.
  - The booking is never auto-completed or auto-cancelled.
- **E.** After check-in the worker gets a **"Client not here"** button.
  - Tapping it sends the client a push and SMS and starts a `noShowGraceMinutes` wait.
  - When the wait ends, the worker gets one-tap **"Cancel: client no-show"**. No photos are needed.
  - The client-fault fee is **auto-approved**, so no admin reviews it.
- **F.** Cash invoices:
  - The auto-settle window goes from 24h to **72h**, with a second reminder to both sides at **48h**.
  - The worker gets a **"Client didn't pay"** button, which opens a dispute.
  - A cash booking that has already been through a dispute is never auto-settled.
- **G.** Evidence photos on invoice reports and payment disputes must be the reporter's own uploads.
- **H.** New notification types `BOOKING_ARRIVED` and `BOOKING_STARTED` replace the reused `BOOKING_ACCEPTED`.
- **Not fixing, by choice:** auto-resolving disputes, and stronger GPS or photo checks.

## Global Constraints

- Every new `NotificationType` value starts with `BOOKING_`, and its `relatedId` is the booking id. Mobile routes push taps by that prefix (`mobile/store/notificationStore.ts` `notificationCategory`).
- Status writes go through `updateBookingIfStatus` (`@services/bookingStatusWrite`), so any race loses cleanly with `isBookingStatusConflict` → `bookingConflict(res)`.
- Never use `:` in BullMQ jobIds.
- Any new queue job name is added to both `src/queues/bookingQueue.ts` and `tests/mocks/bookingQueue.ts`.
- Any new sweep is added to `TASKS` in `src/routes/internalCron.ts`. `cron-sweeps.yml` already hits `/internal/cron/all`, so the workflow file needs no edit.
- Copy is plain English: short sentences, peso amounts written as `₱${n.toFixed(2)}`, booking ids shown through `formatDisplayId`.
- Mobile targets Android only. No iOS work.
- Each new endpoint gets its entry in `backend/openapi.yaml` in the same task that adds it.
- Branch state: `feature/panel-revision-simplify` has a lot of uncommitted work. Before Task 1, commit or stash it, then branch `feature/booking-gaps` off it. Ask the user which.

## Review Focus

1. **A cancel request racing a status change.** Example: the worker taps Agree as the job moves on. Agree must use a status-guarded write and reply 409, never leave a half-cancel. Test is in Task 6.
2. **The C sweep nudging the client while the worker is waiting on them.** A booking with `clientNotHereAt` set must get no "is your worker working?" nudge. Test is in Task 7.
3. **Push taps that open the inbox instead of the booking.** Every new type must start with `BOOKING_` and carry the booking id as `relatedId`. A unit assertion is in Task 1.
4. **A cash booking that went through a dispute and was then kept by the admin.** Without the guard, the 72h auto-settle would mark it paid at once, because `workerCompletedAt` is old. Test is in Task 8.
5. **Repeated `WORKER_NOT_HERE` taps.** These must not SMS the worker more than once every 15 minutes. Test is in Task 6.

---

## File Structure

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` + `migrations/20261027000000_booking_gaps/migration.sql` | New booking columns and notification enum values. The migration dir already exists but is empty, so fill it. |
| `backend/src/services/bookingCancellationService.ts` | **New.** `finalizeCancellationTx`, `afterCancellation`, both moved out of `cancelBooking`. |
| `backend/src/services/cancellationCompensationService.ts` | **New.** `applyClientFaultCompensationTx`, moved out of the admin APPROVE branch. |
| `backend/src/services/bookingProblemService.ts` | **New.** `openBookingDispute`, `escalateCancelRequest`. |
| `backend/src/controllers/bookingController.ts` | Guard A, G, the E endpoint and cancel path, the B endpoints, the F endpoint, H types, detail fields. |
| `backend/src/controllers/paymentController.ts` | G. |
| `backend/src/controllers/adminCancellationController.ts` | Uses the compensation service. |
| `backend/src/controllers/adminDisputeController.ts` | `CANCEL_BOOKING` also allowed on `ACCEPTED` / `IN_PROGRESS`. |
| `backend/src/workers/bookingWorker.ts` | `cancelAsWorkerNoShow` extracted, `nudgeStuckBookings` sweep, F changes. |
| `backend/src/queues/bookingQueue.ts`, `tests/mocks/bookingQueue.ts`, `src/routes/internalCron.ts` | Register the sweep. |
| `backend/src/routes/bookings.ts` | 4 routes. |
| `backend/tests/bookingGaps.test.ts` | **New.** All new behaviour. Same setup as `tests/bookingFlow.test.ts`. |
| `mobile/services/api.ts` | 4 functions. |
| `mobile/components/modals/ProblemReportSheet.tsx` | **New.** Chips + note + Send. |
| `mobile/app/(client)/booking/[bookingId]/index.tsx` | Report button, banners. |
| `mobile/app/(worker)/records/job/[jobId].tsx` | Cancel-request card, Client not here, Client didn't pay. |

---

### Task 1: Schema, notification types, detail fields (H)

**Files:**
- Modify: `backend/prisma/schema.prisma` (`model Booking`, `enum NotificationType`)
- Create: `backend/prisma/migrations/20261027000000_booking_gaps/migration.sql`
- Modify: `backend/src/controllers/bookingController.ts` (`arriveBooking` ~L1698, `startBooking` ~L1855, `getBookingDetail` next to `workerNoShowFlaggedAt` ~L1157 and the worker shape ~L1228)
- Test: `backend/tests/bookingGaps.test.ts`, `mobile/store/__tests__/notificationRoute.test.ts`

**Interfaces:**
- Produces these `Booking` columns, all `DateTime?` unless noted:
  - `workerPingedAt`
  - `cancelRequestedAt`
  - `cancelRequestReason String?`
  - `cancelRequestEscalatedAt`
  - `clientNotHereAt`
  - `startReminderSentAt`
  - `startNudgeSentAt`
  - `progressReminderSentAt`
  - `progressEscalatedAt`
  - `cashSecondReminderSentAt`
- Produces these `NotificationType` values:
  - `BOOKING_ARRIVED`
  - `BOOKING_STARTED`
  - `BOOKING_PROBLEM_REPORTED`
  - `BOOKING_CANCEL_REQUESTED`
  - `BOOKING_CLIENT_NOT_HERE`
  - `BOOKING_REMINDER`
- `getBookingDetail` returns, for both client and worker:
  - `clientNotHereAt`
  - `clientNoShowCancelAt: string | null` (= `clientNotHereAt + noShowGraceMinutes`, null when not set)
  - `cancelRequestedAt`
  - `cancelRequestReason`
  - `cancelRequestEscalatedAt`
  - `hasOpenDispute: boolean` (any dispute `OPEN`/`UNDER_REVIEW`)

- [ ] **Step 1: Write failing tests.** In the new `bookingGaps.test.ts`, copy the `beforeAll`/`afterAll` user, login and cleanup setup from `bookingFlow.test.ts`. Add:
  - `it('tells the client the worker arrived with BOOKING_ARRIVED')`: arrive within the geofence, then `expect(await prisma.notification.findFirst({ where: { userId: clientId, relatedId: booking.id, type: 'BOOKING_ARRIVED' } })).not.toBeNull()`.
  - `it('tells the client the job started with BOOKING_STARTED')`: same pattern after `/start`.
  - `it('returns the new detail fields')`: `GET /api/bookings/:id` as the client. `res.body.data` has `clientNotHereAt: null`, `cancelRequestedAt: null` and `hasOpenDispute: false`.
  - In `mobile/store/__tests__/notificationRoute.test.ts`, assert that each of the six new types routes to `/(client)/booking/b1`.
- [ ] **Step 2: Run.** `cd backend && npx jest tests/bookingGaps.test.ts --runInBand`. Expected: FAIL, unknown enum value / undefined fields.
- [ ] **Step 3: Implement.**
  - Add the columns and enum values to the schema.
  - Write `migration.sql` by hand: `ALTER TYPE "NotificationType" ADD VALUE '...'` ×6, and `ALTER TABLE "Booking" ADD COLUMN ...` ×10. Check it with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script` (needs `--shadow-database-url` = `DIRECT_URL`), which must print nothing new. Then `npx prisma migrate deploy && npx prisma generate`.
  - Switch the two `notifyUser` types to `BOOKING_ARRIVED` / `BOOKING_STARTED` and delete the "closest available" comment.
  - Add the detail fields.
- [ ] **Step 4: Run** both suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bookings): booking-gap columns, BOOKING_ARRIVED/STARTED notifications`.

---

### Task 2: Worker can't cancel after the invoice (A)

**Files:**
- Modify: `backend/src/controllers/bookingController.ts` (`cancelBooking`, after the client guard ~L2925)
- Test: `backend/tests/bookingGaps.test.ts`

- [ ] **Step 1: Failing test.** `it.each(['PENDING_COMPLETION', 'AWAITING_PAYMENT', 'DISPUTED'])('refuses a worker cancel once the invoice is sent (%s)')`.
  - Seed a booking in that status, with `workerArrivedAt` and `workerCompletedAt` set.
  - Worker `PATCH /cancel` with `{ reason: 'Changed my mind about it', fault: 'CLIENT', proofUrls: [photoUrl(workerId,'x')] }`.
  - Expect 409 and `res.body.message` to be `"The invoice is sent, so this job can't be cancelled here. If something is wrong, contact support."`.
  - Expect the booking status unchanged and no `Cancellation` row.
- [ ] **Step 2: Run.** Expected: FAIL, 200.
- [ ] **Step 3: Implement.** If `req.user.role === 'WORKER'` and `!['ACCEPTED','IN_PROGRESS'].includes(booking.status)` (PENDING is already handled by decline), return 409 with exactly that message.
- [ ] **Step 4: Run** this file plus `tests/workerOps.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(bookings): workers can't cancel after sending the invoice`.

---

### Task 3: Evidence photo ownership (G)

**Files:**
- Modify: `backend/src/controllers/bookingController.ts` (`reportInvoice` ~L2800), `backend/src/controllers/paymentController.ts` (~L269)
- Test: `backend/tests/bookingGaps.test.ts`

- [ ] **Step 1: Failing test.** `it("rejects invoice-report evidence that isn't the client's own upload")`.
  - Booking in `PENDING_COMPLETION`.
  - Client reports with `evidenceUrls: [photoUrl(workerId, 'someone-elses')]`.
  - Expect 400, and the status still `PENDING_COMPLETION`.
  - Write a second case that sends `photoUrl(clientId,'mine')` and expects 200.
- [ ] **Step 2: Run.** Expected: FAIL, 200.
- [ ] **Step 3: Implement.** In both controllers, replace the `filter(...)` with `toOwnedBookingPhotoUrls(evidenceUrls ?? [], req.user.userId)`. On `null`, return 400 `'Upload the photos again — one of them could not be verified'` (the existing worker-side copy). Keep the 5-item cap.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(disputes): only accept the reporter's own evidence photos`.

---

### Task 4: Extract shared cancel and compensation logic (refactor, no behaviour change)

**Files:**
- Create: `backend/src/services/bookingCancellationService.ts`, `backend/src/services/cancellationCompensationService.ts`
- Modify: `backend/src/controllers/bookingController.ts` (`cancelBooking` tx ~L2994–3088), `backend/src/controllers/adminCancellationController.ts` (APPROVE branch ~L126–158), `backend/src/workers/bookingWorker.ts` (`cancelWorkerNoShows` loop body)

**Interfaces (produced):**
- `finalizeCancellationTx(tx: Prisma.TransactionClient, booking: Booking, cancelledByRole: 'CLIENT' | 'WORKER' | 'ADMIN', cancellation: Omit<Prisma.CancellationUncheckedCreateInput, 'bookingId'>, notes?: string | null): Promise<Booking>`.
  - Status-guarded write to `CANCELLED` (sets `notes` when given).
  - Decrements `activeJobCount` using today's rule.
  - Cancels `SCHEDULED` visits.
  - Dismisses open disputes, with the existing resolution text using `cancelledByRole`.
  - Creates the `Cancellation` row and returns the reloaded booking.
- `afterCancellation(bookingId: string, reason: string, requestedById?: string): Promise<void>`. Calls `cancelPendingExpiryJob`, then `requestRefund({ source: 'BOOKING_CANCELLED', ... })`, each `.catch`-logged as now.
- `applyClientFaultCompensationTx(tx, { bookingId: string; clientId: string; workerId: string; amount: number; reviewedById: string | null; reviewNote: string }): Promise<boolean>`.
  - Claims `PENDING_REVIEW` → `APPROVED` with `updateMany`, and returns `false` if the count is 0.
  - Sets the client `outstandingBalance` and `paymentHoldAt` / `paymentHoldNote`, then calls `creditCompensationTx` and `postCancellationFee`, exactly as the admin branch does today.
- `cancelAsWorkerNoShow(booking: Booking, settings: { noShowGraceMinutes: number; noShowPenaltyAmount: number }, now?: Date): Promise<boolean>`. Exported from `bookingWorker.ts`: the current loop body, without the deadline check. It returns whether it cancelled.

- [ ] **Step 1: Run the safety net first.** `npx jest tests/workerOps.test.ts tests/bookingFlow.test.ts tests/refundRequests.test.ts --runInBand`. Expected: PASS (baseline).
- [ ] **Step 2: Move the code.**
  - `cancelBooking` keeps its validation, penalty charge and notifications, and calls `finalizeCancellationTx` inside its transaction and `afterCancellation` after it.
  - The admin APPROVE branch calls `applyClientFaultCompensationTx`. On `false`, it throws `ALREADY_REVIEWED` as today.
  - `cancelWorkerNoShows` keeps its deadline `continue` and calls `cancelAsWorkerNoShow`.
- [ ] **Step 3: Re-run** the same suites plus `npx tsc --noEmit`. Expected: PASS, with no test edits.
- [ ] **Step 4: Commit** `refactor(bookings): share cancellation and compensation helpers`.

---

### Task 5: Client not here (E)

**Files:**
- Modify: `backend/src/controllers/bookingController.ts` (new `reportClientNotHere`; `cancelBooking` after-arrival branch), `backend/src/routes/bookings.ts`, `backend/openapi.yaml`
- Test: `backend/tests/bookingGaps.test.ts`

**Interfaces:**
- Consumes: `applyClientFaultCompensationTx` (Task 4), `clientNotHereAt` (Task 1).
- Produces:
  - `PATCH /api/bookings/:id/client-not-here` (WORKER), returning `{ clientNotHereAt: string, canCancelAt: string }`.
  - `PATCH /:id/cancel` with `{ fault: 'CLIENT' }` and no proof is accepted once `canCancelAt` has passed.

- [ ] **Step 1: Failing tests.**
  - `it('alerts the client and gives the worker a cancel time')`: ACCEPTED booking with `workerArrivedAt` set → 200. `canCancelAt` = `clientNotHereAt + noShowGraceMinutes`. A `BOOKING_CLIENT_NOT_HERE` notification exists for the client.
  - `it('is idempotent and needs a check-in first')`: a second call returns the same `clientNotHereAt` and creates no second notification. A booking without `workerArrivedAt` → 409 `'Check in at the job site first'`.
  - `it('cancels as a client no-show without proof once the wait is over, fee auto-approved')`:
    - Set `clientNotHereAt` to `now - (grace+1) min`.
    - Worker `PATCH /cancel` with `{ fault: 'CLIENT' }` → 200, `compensationStatus: 'APPROVED'`.
    - The cancellation has `reviewedById` null, the client has `paymentHoldAt` set, and the worker profile was credited by `clientFaultCompensationAmount`.
    - No `CANCELLATION_COMPENSATION` notification went to an admin.
  - `it('still needs proof before the wait is over')`: `clientNotHereAt = now` → `{ fault: 'CLIENT' }` without proof → 400 (existing message).
- [ ] **Step 2: Run.** Expected: FAIL, 404 route.
- [ ] **Step 3: Implement.**
  - `reportClientNotHere`:
    - Checks: worker assigned, `status === 'ACCEPTED'`, `workerArrivedAt` set.
    - If `clientNotHereAt` is already set, return it.
    - Otherwise set it (status-guarded) and send the client `notifyUser` type `BOOKING_CLIENT_NOT_HERE`, title `'Your worker is at your door'`, message `'Your worker checked in and can't reach you. Please come to the door or message them.'`, plus `sendSmsToUser` with the same text and `formatDisplayId`.
  - In `cancelBooking`, compute `clientNoShowConfirmed = afterArrival && fault === 'CLIENT' && booking.status === 'ACCEPTED' && booking.clientNotHereAt != null && Date.now() >= booking.clientNotHereAt.getTime() + settings.noShowGraceMinutes * 60_000`. When true:
    - Skip the proof and reason checks, and default `reason` to `'Client was not home'`.
    - Inside the tx after `finalizeCancellationTx`, call `applyClientFaultCompensationTx` with `reviewedById: null` and `reviewNote: 'Auto-approved: worker checked in by GPS and waited after alerting the client'`.
    - Send the client the admin APPROVE copy with `" If you were home, contact support."` appended.
    - Send the worker the admin APPROVE worker copy.
    - Skip the admin review notification.
    - Return `compensationStatus: 'APPROVED'`.
  - Add the route and the openapi entry.
- [ ] **Step 4: Run** this file plus `tests/workerOps.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bookings): client-not-here alert and auto-approved client no-show`.

---

### Task 6: Report a problem + cancel requests (B)

**Files:**
- Create: `backend/src/services/bookingProblemService.ts`
- Modify: `backend/src/controllers/bookingController.ts` (new `reportBookingProblem`, `respondToCancelRequest`), `backend/src/controllers/adminDisputeController.ts` (~L513 allowed list), `backend/src/routes/bookings.ts`, `backend/openapi.yaml`
- Test: `backend/tests/bookingGaps.test.ts`

**Interfaces:**
- Consumes: `finalizeCancellationTx`, `afterCancellation`, `cancelAsWorkerNoShow` (Task 4).
- Produces:
  - `openBookingDispute({ bookingId, raisedById, reason }): Promise<Dispute | null>`. Returns `null` if an `OPEN`/`UNDER_REVIEW` dispute exists. Otherwise it creates one and notifies every admin with type `DISPUTE_OPENED`, title `'Problem reported'`, message `` `Booking ${formatDisplayId(bookingId)}: ${reason}` ``.
  - `escalateCancelRequest(booking: Booking, why: 'DECLINED' | 'NO_ANSWER'): Promise<void>`.
    - Sets `cancelRequestEscalatedAt`.
    - Calls `openBookingDispute` with reason `` `Client asked to cancel (${booking.cancelRequestReason ?? 'no reason given'}); worker ${why === 'DECLINED' ? 'declined' : "didn't answer"}` ``.
    - Notifies the client with type `BOOKING_PROBLEM_REPORTED`, message `'Your worker didn't agree to cancel, so HomeEase will decide. We'll tell you the outcome.'` (use `"didn't answer"` wording for `NO_ANSWER`).
  - `POST /api/bookings/:id/problem` (CLIENT) with body `{ reason: 'WORKER_NOT_HERE' | 'WORKER_STOPPED' | 'NEED_TO_CANCEL' | 'OTHER', note?: string }`. It returns `{ outcome: 'WORKER_PINGED' | 'CANCELLED' | 'CANCEL_REQUESTED' | 'REPORTED', autoCancelAt?: string }`.
  - `PATCH /api/bookings/:id/cancel-request/respond` (WORKER) with body `{ accept: boolean }`.

Rules for `/problem`:
- **Status.** `ACCEPTED` or `IN_PROGRESS`, else 409 `'You can report a problem here until your worker sends the invoice'`.
- **Note.** Optional, at most 500 characters. Required (≥10 characters) for `OTHER`.
- **`WORKER_NOT_HERE`:**
  - `ACCEPTED` and not arrived, with `now ≥ start + noShowGraceMinutes`: run `cancelAsWorkerNoShow`, returning `CANCELLED`.
  - `ACCEPTED`, not arrived, before that deadline:
    - If `workerPingedAt` is within 15 min, return 429 `'We already pinged your worker. Give them a few minutes.'`.
    - Otherwise set `workerPingedAt` and send the worker `BOOKING_REMINDER` "Your client is waiting" (push + SMS).
    - Return `WORKER_PINGED` with `autoCancelAt = start + grace`.
  - Otherwise, fall through to the dispute rule.
- **`NEED_TO_CANCEL`:** 409 if `cancelRequestedAt` is set. Otherwise set `cancelRequestedAt` and `cancelRequestReason = note ?? null`. Send the worker `BOOKING_CANCEL_REQUESTED`: title `'Your client wants to cancel'`, message `'Open the job to agree or decline.'`. Return `CANCEL_REQUESTED`.
- **`WORKER_STOPPED` / `OTHER` / fall-through:** `openBookingDispute` with the reason label + note. A `null` result means 409 `'You already reported this. HomeEase is on it.'`. Notify the worker with `BOOKING_PROBLEM_REPORTED`. Return `REPORTED`.

Rules for `/cancel-request/respond`:
- **Preconditions.** The worker is assigned, the status is `ACCEPTED`/`IN_PROGRESS`, `cancelRequestedAt` is set and `cancelRequestEscalatedAt` is null. Otherwise 409 `'There is no cancel request to answer'`.
- **`accept: true`:**
  - Call `finalizeCancellationTx(tx, booking, 'CLIENT', { cancelledBy: 'CLIENT', cancelledById: booking.clientId, reason: 'CLIENT_CANCEL_AGREED', penalizedWorkerId: null, compensationStatus: 'NOT_APPLICABLE' })`, then `afterCancellation`.
  - Notify the client with `BOOKING_CANCELLED`: `'Your worker agreed. The booking is cancelled and you won't be charged.'`
- **`accept: false`:** `escalateCancelRequest(booking, 'DECLINED')`.

Admin: add `'ACCEPTED', 'IN_PROGRESS'` to the `CANCEL_BOOKING` allowed statuses. The existing `!booking.workerCompletedAt` branch already decrements `activeJobCount`.

- [ ] **Step 1: Failing tests** (one `it` each):
  - pings the worker before the deadline, and returns `autoCancelAt`
  - a second ping within 15 min → 429, with one SMS/notification only (Review Focus 5)
  - cancels as a no-show past the deadline → booking `CANCELLED`, `Cancellation.reason === 'WORKER_NO_SHOW'`
  - `WORKER_STOPPED` opens one dispute, and a repeat → 409
  - `OTHER` without a note → 400
  - `NEED_TO_CANCEL` → worker Agree → `CANCELLED`, `penalizedWorkerId` null, no penalty on `commissionOwed`, `activeJobCount` decremented
  - `NEED_TO_CANCEL` → worker Decline → an open dispute exists, `cancelRequestEscalatedAt` is set, and a second respond → 409
  - Agree after the booking moved to `PENDING_COMPLETION` → 409, with no `Cancellation` row (Review Focus 1)
  - `/problem` on `PENDING_COMPLETION` → 409
  - admin `CANCEL_BOOKING` on an `IN_PROGRESS` booking's dispute → `CANCELLED`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** to the rules above. Add the routes and openapi entries.
- [ ] **Step 4: Run** this file plus `tests/bookingFlow.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bookings): client problem reports and agreed cancellations`.

---

### Task 7: Stuck-booking sweep (B timeout, C, D)

**Files:**
- Modify: `backend/src/workers/bookingWorker.ts` (new `nudgeStuckBookings`, switch case), `backend/src/queues/bookingQueue.ts`, `backend/tests/mocks/bookingQueue.ts`, `backend/src/routes/internalCron.ts`
- Test: `backend/tests/bookingGaps.test.ts`

**Interfaces:**
- Produces: `export async function nudgeStuckBookings(now = new Date()): Promise<void>`
  - `JOB_NAMES.STUCK_BOOKING_SWEEP = 'stuck-booking-sweep'`
  - `REPEATABLE_JOB_IDS.STUCK_BOOKING_SWEEP = 'stuck-booking-sweep-10min'`, pattern `'*/10 * * * *'`
  - cron task `'nudge-stuck-bookings'`

Constants, next to the existing ones:
- `CANCEL_REQUEST_TIMEOUT_HOURS = 2`
- `START_REMINDER_MINUTES = 30`
- `START_NUDGE_HOURS = 2`
- `PROGRESS_REMINDER_HOURS = 12`
- `PROGRESS_ESCALATE_HOURS = 48`

The three passes, each in its own try/catch per booking:
1. **Cancel requests.** `cancelRequestedAt` set, `cancelRequestEscalatedAt` null, status `ACCEPTED`/`IN_PROGRESS`, and `now ≥ deadline`: `escalateCancelRequest(b, 'NO_ANSWER')`. The deadline is:
   - `IN_PROGRESS`: `cancelRequestedAt + 2h`
   - `ACCEPTED`: `min(cancelRequestedAt + 2h, max(booked start, cancelRequestedAt + 15 min))`, so the worker always gets at least 15 min.
2. **Not started.** `ACCEPTED`, `workerArrivedAt` set. `clock = max(workerArrivedAt, bookingStartInstant(b))`.
   - At `+30 min`, with `startReminderSentAt` null: the worker gets `BOOKING_REMINDER` `'Tap Start Job'` / `'You checked in but haven't started. Add your before photos and tap Start Job.'`
   - At `+2h`, with `startNudgeSentAt` null **and `clientNotHereAt` null**: the client gets `BOOKING_REMINDER` `'Is your job under way?'` / `'Your worker checked in but hasn't started. If something's wrong, tap Report a problem.'`
3. **In progress.** `IN_PROGRESS`. `clock = max(workerStartedAt, latest bookingStartInstant(visit) over visits with status !== 'CANCELLED')`. Skip if the clock is in the future.
   - At `+12h`, with `progressReminderSentAt` null: the worker gets `BOOKING_REMINDER` `'Finish or schedule a follow-up'` / `'This job is still in progress. Mark it complete, or schedule a follow-up visit.'`
   - At `+48h`, with `progressEscalatedAt` null: the client gets `BOOKING_REMINDER` `'Is your job finished?'` / `'Your job is still marked in progress. If something's wrong, tap Report a problem.'`, and every admin gets a `BOOKING_REMINDER` with the display id.

Stamp the `*SentAt` / `progressEscalatedAt` column right after each send.

- [ ] **Step 1: Failing tests** that call `nudgeStuckBookings()` directly, the way `workerOps.test.ts` calls `cancelWorkerNoShows`:
  - an unanswered cancel request is escalated after 2h → dispute open
  - a request made after the booked start is not escalated at 10 min, but is at 16 min
  - an arrived-not-started booking: worker reminder at 31 min, none at 29 min. A second run sends nothing new.
  - a client nudge at 2h; no client nudge when `clientNotHereAt` is set (Review Focus 2)
  - an early check-in (arrived 3h before the booked start, start in 1h) → no reminder yet
  - in progress at 49h → worker reminder + client nudge + an admin notification; with a visit scheduled tomorrow → nothing
- [ ] **Step 2: Run.** Expected: FAIL, not exported.
- [ ] **Step 3: Implement** the sweep, the queue registration (copy the `NO_SHOW_SWEEP` block), the mock `JOB_NAMES` entry, the switch case and the cron task.
- [ ] **Step 4: Run** this file plus `npm run test:queues`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bookings): sweep that nudges stuck bookings`.

---

### Task 8: Cash invoices (F)

**Files:**
- Modify: `backend/src/workers/bookingWorker.ts` (`remindAndAutoSettleCompletions`), `backend/src/controllers/bookingController.ts` (new `reportCashNotPaid`), `backend/src/routes/bookings.ts`, `backend/openapi.yaml`
- Test: `backend/tests/bookingGaps.test.ts`

**Interfaces:**
- Produces: `PATCH /api/bookings/:id/cash-not-paid` (WORKER), with no body. It returns `{ id, status: 'DISPUTED', disputeId }`.

- [ ] **Step 1: Failing tests:**
  - cash invoice at 25h → still `PENDING_COMPLETION`; at 73h → `COMPLETED`
  - at 49h → a second reminder to the client and worker (`COMPLETION_REMINDER`), sent once
  - a cash booking with `disputeResolvedAt` set and `workerCompletedAt` 100h ago → not auto-settled (Review Focus 4)
  - worker `cash-not-paid` → `DISPUTED`, an open dispute with reason `'Worker reports the client has not paid the cash invoice'`, and the client gets `DISPUTE_OPENED`; then `cash-received` → 409 (existing DISPUTED copy)
  - `cash-not-paid` on a GCash booking → 409 `'This client pays with GCash or Maya in the app'`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Set `CASH_AUTO_SETTLE_HOURS = 72` and update its comment. Add `CASH_SECOND_REMINDER_HOURS = 48`, as a pass after the 12h reminder that stamps `cashSecondReminderSentAt`. Message to the client: `'Your cash invoice is still open. It will be recorded as paid in 1 day unless you report it.'` Message to the worker: the existing "Did you get the cash?" copy.
  - Add `disputeResolvedAt: null` to the `staleCash` where.
  - `reportCashNotPaid` mirrors `reportInvoice`: the same status guard (`PENDING_COMPLETION` only, cash only), the `DISPUTED` transition and dispute create in one tx, and notifications to the client and admins (no void: cash). Update the existing `bookingFlow`/`workerOps` tests that assume 24h, if any. Search for `CASH_AUTO_SETTLE` and `24` near `settle`.
- [ ] **Step 4: Run** the full `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(payments): 72h cash window and a Client didn't pay button`.

---

### Task 9: Mobile — client Report a problem

**Files:**
- Modify: `mobile/services/api.ts`, `mobile/app/(client)/booking/[bookingId]/index.tsx`
- Create: `mobile/components/modals/ProblemReportSheet.tsx`
- Test: `mobile/components/modals/__tests__/ProblemReportSheet.test.tsx`

**Interfaces:**
- Produces in `api.ts`, written in the style of `reportInvoice`:
  - `reportBookingProblem(bookingId: string, reason: ProblemReason, note?: string): Promise<{ outcome: 'WORKER_PINGED' | 'CANCELLED' | 'CANCEL_REQUESTED' | 'REPORTED'; autoCancelAt?: string }>`
  - `export type ProblemReason = 'WORKER_NOT_HERE' | 'WORKER_STOPPED' | 'NEED_TO_CANCEL' | 'OTHER'`
- `ProblemReportSheet` props: `{ visible: boolean; workerArrived: boolean; inProgress: boolean; loading?: boolean; onSend: (reason: ProblemReason, note?: string) => void; onCancel: () => void }`
  - Chips: "Worker isn't here" (hidden when `workerArrived`), "Worker stopped working" (shown only when `inProgress`), "I need to cancel", "Other".
  - Send is disabled until a chip is picked, and for Other until the note is ≥10 characters.

- [ ] **Step 1: Failing test.** Render with `workerArrived` false: tap "I need to cancel", tap Send → `onSend` is called with `('NEED_TO_CANCEL', undefined)`. "Other" with a 3-character note leaves Send disabled.
- [ ] **Step 2: Run.** `cd mobile && npx jest components/modals/__tests__/ProblemReportSheet.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The sheet uses the same modal shell and NativeWind classes as `ReportModal`.
  - On the detail screen, add an `OutlinedButton` "Report a problem" when `rawDetail.status` is `ACCEPTED` or `IN_PROGRESS`, `!rawDetail.hasOpenDispute` and `!rawDetail.cancelRequestedAt`.
  - Show the result with `alertModal.success`, then `load()`:
    - `WORKER_PINGED`: "We pinged your worker. If they're not there by {time}, the booking is cancelled for free."
    - `CANCELLED`: "Booking cancelled. You won't be charged."
    - `CANCEL_REQUESTED`: "We asked your worker. You'll hear back within 2 hours."
    - `REPORTED`: "Reported. HomeEase will contact you."
  - Banners:
    - `cancelRequestedAt && !cancelRequestEscalatedAt` → "Waiting for your worker to agree to cancel."
    - `hasOpenDispute` → the existing "Under review" card style.
    - `clientNotHereAt && status ACCEPTED` → "Your worker is at your door."
  - Change the "cannot cancel" text in `success.tsx` (L255) to "Your worker has accepted. Open the booking and tap Report a problem if you need to cancel."
- [ ] **Step 4: Run** `npx jest`, `npx tsc --noEmit` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): client Report a problem sheet`.

---

### Task 10: Mobile — worker controls

**Files:**
- Modify: `mobile/services/api.ts`, `mobile/app/(worker)/records/job/[jobId].tsx`

**Interfaces:**
- Produces in `api.ts`:
  - `respondToCancelRequest(bookingId: string, accept: boolean)`
  - `reportClientNotHere(bookingId: string): Promise<{ clientNotHereAt: string; canCancelAt: string }>`
  - `reportCashNotPaid(bookingId: string)`
- Consumes: `cancelBooking(id, 'Client was not home', undefined, { fault: 'CLIENT', proofUrls: [] })` (the existing signature).

- [ ] **Step 1: Implement**, all inside the existing action area and with the existing `PrimaryButton`/`OutlinedButton`/`alertModal`:
  - **Cancel request card** (`cancelRequestedAt && !cancelRequestEscalatedAt`). Text: "Your client wants to cancel" plus the reason. Two buttons, **Agree** (Primary) and **Decline** (Outlined). Agree confirms with "Cancel this job? No penalty for you or the client." Decline acts at once with no confirm. Both call `load()` afterwards.
  - **Client not here** (`isAccepted && hasArrived && !clientNotHereAt`). An OutlinedButton that calls `reportClientNotHere`, then shows "We alerted your client. You can cancel at {time} if they don't come."
    - Once `clientNotHereAt` is set: show a text line "Waiting for the client until {clientNoShowCancelAt}". After that time, show a PrimaryButton **"Cancel: client no-show"**, with the confirm "Cancel and charge the client the no-show fee?" A 30s interval re-checks the time, the same way the elapsed-time effect does.
  - **Client didn't pay** (`isPendingCompletion && isCash`). A small text button under Cash received, with confirm "Tell HomeEase the client hasn't paid? An admin will follow up." It calls `reportCashNotPaid`.
- [ ] **Step 2: Verify** `npx tsc --noEmit` and `npm run lint`: PASS. Then run it on the Android emulator with the backend running, through two flows:
  - check in → Client not here → (set `noShowGraceMinutes` to 1 in admin) → Cancel: client no-show
  - client NEED_TO_CANCEL → worker Agree
- [ ] **Step 3: Commit** `feat(mobile): worker cancel-request, client-not-here and unpaid-cash controls`.

---

### Task 11: Final verification

- [ ] `cd backend && npx tsc --noEmit && npm run typecheck:tooling && npm run build && npm test && npm run test:queues`: all PASS.
- [ ] `cd mobile && npx tsc --noEmit && npm run lint && npm test`: all PASS.
- [ ] Update `CLAUDE.md` "Booking lifecycle" with one sentence each on: Report a problem / cancel requests, client-not-here auto-fee, the 72h cash window, and the stuck-booking sweep.
- [ ] After merge, mobile needs **`eas update`** only: JS changes, no native modules or config.
