# Fill three worker/booking gaps

## Context

A review of the worker/booking flows surfaced three gaps:

1. Workers have no in-app way to pick which service categories (`ServiceType`, e.g. "Cleaning", "Plumbing") they offer — today it can only be set by directly editing the DB, even though a backend endpoint for it already exists and is simply never called from the mobile app.
2. A worker with `kycStatus: PENDING` (the default on registration) is immediately returned by worker search and can be booked — there is no verification gate anywhere in the backend.
3. The payment method a client picks on booking-creation step 3 is selected in local UI state only and never sent with the `createBooking` request, even though the backend and API client both already support `paymentMethodType`/`paymentAccountIdentifier` on that call (a separate, unreachable "Proceed to Payment" screen shows the code was written once but wired to a dead route).

Decisions confirmed with the user:
- The category picker should be modeled directly on the existing "My Skills & Services" screen (`mobile/app/(worker)/profile/skills/index.tsx`) rather than added to onboarding/KYC — profile-only, editable anytime.
- KYC enforcement should be full: unverified workers must not appear anywhere a client can see or book them.
- Actual AI/resume-based auto-detection of categories (`ResumeParseResult` is schema-only scaffolding with zero implementation) is explicitly out of scope for this pass — this plan only builds the manual self-serve path.

---

## 1. Self-serve service categories (worker profile)

**Backend** — `backend/src/controllers/workerController.ts`, `backend/src/routes/workers.ts`

- `POST /me/service-types` (`addServiceTypes`, workerController.ts:470-507) already exists and works (connects `ServiceType`s to the worker) — no client code calls it today, and there's no way to read or remove them. Add the missing two, mirroring the existing skills CRUD pattern (`listMySkills`/`deleteSkill`, workerController.ts:553-582 and 629-662):
  - `listMyServiceTypes` — `GET /me/service-types`: fetch the authenticated worker's `WorkerProfile.serviceTypes`.
  - `removeServiceType` — `DELETE /me/service-types/:serviceTypeId`: verify the id is currently connected to this worker (404 if not, same ownership-check shape as `deleteSkill`), then `prisma.workerProfile.update({ where: { userId }, data: { serviceTypes: { disconnect: { id: serviceTypeId } } } })`.
- Wire both into `backend/src/routes/workers.ts` next to the existing `POST /me/service-types` route (line 59-65), same `authMiddleware`/`restrictTo('WORKER')` guards as the skills routes (lines 74-76). No new validation middleware needed (no body on either route).

**Mobile API client** — `mobile/services/api.ts`

- Add `getMyServiceTypes()` (`GET /workers/me/service-types`), `addServiceTypes(ids: string[])` (`POST /workers/me/service-types` — currently has no client wrapper at all despite the backend supporting it), and `removeServiceType(serviceTypeId: string)` (`DELETE /workers/me/service-types/:id`), following the exact `getMySkills`/`addSkill`/`deleteSkill` pattern at api.ts:1156-1184.

**Mobile UI** — `mobile/app/(worker)/profile/skills/index.tsx`

The worker profile menu already links here under the label "My Skills & Services" (`mobile/app/(worker)/profile/index.tsx:19`), which today only manages the free-text `Skill` model. Add a new "Service Categories" section above the existing Skills `FlatList`, using the same visual language already in this file:
- On mount, load `getMyServiceTypes()` (selected) and `getServiceTypes()` (full catalog, existing call already used by `ServiceTypePickerBottomSheet`).
- Render selected categories as removable chips; tapping remove calls `removeServiceType` with an `alertModal.confirm` guard (same pattern as `handleDeleteSkill`).
- An "+ Add Category" pill opens a small modal — reuse the existing Add-Skill `Modal` styling in this file — listing all catalog categories as toggleable chips (not connected yet = tappable to select), with a Save button that calls `addServiceTypes(newlySelectedIds)`.
- Don't touch `ServiceTypePickerBottomSheet` itself — it's single-select and shared with the client booking flow (`booking/new/step-1.tsx`); build the multi-select toggle UI inline in this screen instead.

---

## 2. Enforce KYC verification everywhere a worker is discoverable

**`backend/src/controllers/workerController.ts`**

- `searchWorkers` (lines 15-113): add `kycStatus: 'APPROVED'` to `whereClause` alongside the existing `isAvailable: true` (line 24), so unapproved workers never appear in `GET /api/workers` results (used by both the category-browse and select-worker mobile screens).
- `getWorkerDetail` (lines 119-202): after the existing `if (!worker)` 404 check (line 162), add `if (worker.kycStatus !== 'APPROVED') return res.status(404).json(errorResponse(404, 'Worker not found'))` — treat an unverified worker the same as nonexistent so a stale/guessed `workerId` in a deep link can't reveal an unverified profile either.

**`backend/src/controllers/bookingController.ts`**

- `createBooking` (lines 49-229): right after the existing `!worker.isAvailable` check (lines 81-83), add `if (worker.kycStatus !== 'APPROVED') return res.status(403).json(errorResponse(403, 'Worker is not verified yet'))`.
- Repeat the same check inside the transaction's re-fetch (after line 130's `!workerProfile.isAvailable` check) as defense-in-depth against a race where a worker's status changes between the outer check and the transaction.

**Not touched:** `adminVerificationController.ts`'s `listVerifications` must keep showing workers of every status — admins need to see `PENDING`/`SUBMITTED` workers in order to review and approve them. No mobile changes needed either — the search/detail/booking screens already just render whatever the backend returns, so filtering server-side is sufficient.

---

## 3. Send the chosen payment method with booking creation

**`mobile/app/(client)/booking/new/step-3.tsx`**

The now-unreachable `booking/payment/index.tsx` screen already contains the correct logic (lines 94, 108-109, 60-68) — port it into step-3 rather than reinventing it:

- Import `PAYMENT_METHOD_TYPE_MAP` from `mobile/utils/paymentMethodMap.ts` (already used by `payment/index.tsx` and the booking-detail auto-charge path).
- Add an `accountValue` text-input state, shown conditionally for `gcash`/`maya`/`bank` (copy the three conditional `TextInput` blocks from `payment/index.tsx:208-263` verbatim — same placeholder/label copy), left out entirely for `cash`.
- Before calling `handleConfirmBooking`, validate that `accountValue` is filled when the selected method requires it (mirror `payment/index.tsx:60-68`).
- In the `bookingData` object (step-3.tsx:94-120), add:
  ```ts
  paymentMethodType: PAYMENT_METHOD_TYPE_MAP[paymentMethod ?? ""] ?? "CASH",
  paymentAccountIdentifier: accountValue.trim() || undefined,
  ```

No backend changes needed — `bookingController.ts` already destructures and persists both fields (lines 68-69, 166-167). Leave `booking/payment/index.tsx` and its route as-is; it's dead code reachable by nothing today, and removing it is a separate cleanup not required to close this gap.

---

## Verification

- Backend: `cd backend && npx tsc --noEmit` (or the project's existing build/test script) to catch type errors in the new controller/route code.
- Manual/API check: register a new worker (starts `kycStatus: PENDING`), confirm `GET /api/workers` and `GET /api/workers/:id` no longer return it, confirm `POST /bookings` against it 403s; approve via the existing admin verification flow, confirm it now appears and is bookable.
- Mobile: run the app (Expo), as a worker open Profile → "My Skills & Services", add and remove a service category, reload the screen and confirm the selection persisted (round-trips through the new GET).
- Mobile: as a client, run through booking steps 1→3, pick GCash on step 3, submit, and confirm (via DB or an admin/debug view) the created `Booking` row has `paymentMethodType: GCASH` and a non-null `paymentAccountIdentifier`; then mark that booking completed and confirm "Proceed to Payment" auto-charges via `settledMethodType` without re-prompting for a method.
