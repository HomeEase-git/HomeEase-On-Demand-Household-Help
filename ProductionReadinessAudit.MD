# HomeEase Production-Readiness Audit — 2026-08-04

Full 7-area audit against panelist feedback, verified against current file state (not assumed from prior fix history). Priority: **Blocking** = must fix pre-deploy, **High** = fix before real users hit it at scale, **Medium** = fix soon but not launch-blocking.

## 1. Frontend–backend integration

| Finding | Where | Priority |
|---|---|---|
| `downloadReceipt()` returns a hardcoded fake PDF URL via `delay(400)` instead of a real call | `mobile/services/api.ts:911-918` | Medium (dead code today — zero callers — but a landmine if ever wired to a button) |
| Worker Digital ID fields (`trade`, `serviceArea`, `licenseNumber`) are written only to local Zustand state; no `api.ts` function or Prisma field exists for them | `mobile/app/(worker)/profile/edit.tsx:83-87`, `workerProfileStore.ts:35` | **High** — data silently lost on logout/reinstall/second device |
| `post-service.tsx` reads booking data from the local store and submits reviews via the store's local-only `submitReview` action — never calls the backend; real path (`profile/rate-review/[bookingId].tsx`) exists in parallel | `mobile/app/(client)/booking/post-service.tsx:47,74-75` | Medium (screen is orphaned — see §7 — so currently unreachable, but should be deleted, not left live) |
| `bookingStore` seeds initial state from fake fixture data (`BK-001`…`BK-004`) before the real `getBookings()` fetch overwrites it | `mobile/store/bookingStore.ts:2,222`, `mobile/constants/dummyData.ts:70-113` | Medium |
| `track.tsx` computes booking status/step from a potentially stale store snapshot rather than a fresh fetch | `mobile/app/(client)/booking/[bookingId]/track.tsx:17-40` | Medium |

**Verdict:** integration is in good shape — ~89 of ~90 `api.ts` functions make real calls. The remaining gaps are about **stores silently substituting for the backend** on specific fields/screens rather than mocked network calls.

## 2. Worker verification & onboarding vs. panelist feedback

- **TESDA/PRC feasibility:** No government-registry API integration exists anywhere. The KYC upload screens and the worker contract are honest about this — `contract.tsx:61-62` states outright *"HomeEase does not independently verify the authenticity of submitted documents."* The only "AI" step (`verificationAiService.ts`) sends document images to Claude for a legitimacy/quality opinion (or falls back to a heuristic file-count check), and that output is explicitly advisory — final approve/reject is always a human admin action. Defensible given no public verification API exists. **Medium** (document, don't need to build further automation).
- **Resume parsing screen — Blocking.** `mobile/app/(worker)/profile/resume-preview.tsx` is 100% hardcoded fake data (fabricated name, employers, "92% match score", "Powered by Claude AI · Analyzed just now") shown identically to every worker, reachable from the profile menu. Contradicts the honesty standard the contract screen sets elsewhere. Schema (`ResumeParseResult`, `schema.prisma:410-426`) is real but has **zero write path** anywhere in the backend.
- **Worker Service Contract — mostly good, one thin spot.** `contract.tsx` is shown at the correct point (last onboarding step before `pending`), covers commission (10%), conduct, and dispute handling — but the dispute section is thin: no appeals process, no timeline, just "HomeEase's decision is final." **Medium.** Acceptance is genuinely persisted (`ContractAcceptance` row), though `ipAddress`/`userAgent` fields exist on the schema and are never populated. Minor UI bug: worker's "Continue" button is mislabeled "Continue to Certifications" — Low.
- **KYC rejection reason not surfaced — High.** Backend captures a real admin-written rejection reason, but no API/type ever returns it to the client; `rejected.tsx` always shows a static canned message regardless of actual cause.
- **Orphan/reachability check — no orphans found.** All `(kyc)` screens are driven by real backend `kycStatus`, enforced at 3 independent layers (sign-in redirect, `(worker)/_layout.tsx` route guard, `pending.tsx` 20s poll).
- **TOCTOU gap — Medium.** `createBooking`'s in-transaction re-check re-verifies capacity/slot but not `kycStatus`.

## 3. Service logic and scheduling

- **Pricing is still effectively fixed-rate, not scope/duration-driven — High.** Backend's authoritative formula (`bookingController.ts` `createBooking`) is `ServiceTask.basePrice + conditionFee(0%/0%/+25%) + distanceFee`. `rooms` is stored but never read in the price calc; `workerProfile.hourlyRate` is never referenced there either. The client-side "estimate" shown throughout the booking wizard uses a completely different formula and is explicitly documented as "UX-only, intentionally different."
- **Add-on pricing — schema/API ready, UI not — High.** `BookingAddOn.price` and `POST /bookings/:id/addons` are fully functional, but the only add-ons the client can pick are three free toggles always sent with `price: 0`. No priced-add-on catalog or picker UI exists.
- **Scope creep / mid-job quotes — fully implemented, no blocking gaps.** `QuoteStatus` (PENDING/SUBMITTED/APPROVED/DISPUTED) drives a real state machine end-to-end, including admin dispute resolution.
- **Worker concurrency — enforced server-side.** `maxConcurrentJobs` (default 2)/`activeJobCount` checked pre- and inside-transaction at both `createBooking` and `acceptBooking`; DB-level unique constraint prevents same-slot double-booking. `mobile/hooks/useWorkerCapacity.ts` exists but is purely decorative — reads local Zustand cache, used only on browse screens outside the booking wizard. **Medium.**
- The 10-minute post-worker-selection "hold" timer is explicitly documented as not a real server-side reservation. **Low/Medium.**

## 4. Financial model and payments

- **Client-facing total-amount drift — Blocking.** Two incompatible tax models coexist: backend's real one (5% withholding tax deducted from the *worker's* payout only — `subtotal + tip` is the actual PayMongo charge) vs. a legacy client-side model in `mobile/utils/pricing.ts` (12% "tax" + 10% commission **added on top**), still live in `booking/[bookingId]/index.tsx`'s price breakdown card.
- **Tips — fully real, no gap.**
- **Commission/escrow architecture — Blocking gap on disbursement.** Commission/withholding tax are real, DB-configurable, and persisted per-`Payment`. PayMongo is genuinely wired for **collection**. But **worker payout is entirely unimplemented** — "escrow released" is just a DB status flip; code comments describe disbursement as an "off-platform payout run" outside this system. Xendit doesn't appear anywhere.
- **Refunds are half-wired — High.** Admin dispute resolution can trigger a cancel+refund path, but a captured CARD payment has no real PayMongo refund API call behind it.
- **Hardcoded/duplicated constants — Medium.** Commission fallbacks (`* 0.1`) duplicated in two worker screens. `.env.example`/CI declare `PLATFORM_COMMISSION_RATE`/`VAT_RATE` but code reads `COMMISSION_RATE`/`WITHHOLDING_TAX_RATE` and never reads `VAT_RATE`. Admin `Payments.jsx` hardcodes a "~15%" commission label vs. the real configurable default (10%).

## 5. Data model integrity

Schema is more complete than a typical prototype: Quote fields inline on `Booking`, dedicated `BookingAddOn` table, `Booking.tip`/`Payment.tip`, persisted `commissionAmount`/`withholdingTaxAmount`/`workerPayout` per `Payment`, per-document KYC status, slot-level and capacity-level concurrency tracking.

- **Stale financial data on quote/add-on jobs — High.** `captureAndReleasePayment` never recomputes `commissionAmount`/`withholdingTaxAmount`/`workerPayout` against the final captured amount when it differs from what was estimated at authorization.
- **Per-document KYC status is modeled but unused — Medium.** Admin tooling only operates at the whole-submission level.
- **Schema is freshly assembled and uncommitted — Blocking.** The entire booking-flow/matching/dispute/pricing-log/worker-availability subsystem (3 migrations, dated 2026-08-03) is still untracked in git.

## 6. Admin and moderation infrastructure

**A real admin backend now exists**, verified end-to-end: KYC approve/reject with Tier-1 document-completeness gate; dispute resolution (approve quote / request new quote / cancel+refund-flag); payments/payouts/commission reporting with CSV export.

**Still missing:** per-document KYC actions, a real refund trigger for captured CARD payments, and — the biggest gap — no payout/disbursement action exists at all because the underlying capability isn't built. Admin can see what workers are owed; nothing can pay them.

## 7. Navigation and dead ends

- **Password reset is broken end-to-end — Blocking.** `forgot-password.tsx` → `password-reset-sent.tsx` never forwards to `reset-password.tsx`; that screen has zero inbound navigation anywhere in the app.
- **Other orphans (dead code, should be deleted):** `verify-email.tsx`, `address-picker.tsx`, `post-service.tsx`, `profile/rate-review.tsx` (list screen).
- **Deleted screens are cleanly removed** — `booking/payment/*`, `booking/select-worker.tsx`, `AddOnsSelector.tsx`, `useBookingAvailability.ts` are gone with zero dangling references.
- **Fake reference numbers:** all real IDs are Prisma `cuid()`s. `dummyData.ts`'s `BK-`/`TXN-`-prefixed fixtures are inert but remain a landmine. `useSyncQueue`'s "sync now" is a stub that never actually replays queued requests.

---

## Prioritized punch list

1. Fix the broken password-reset navigation.
2. Build worker payout/disbursement (PayMongo payout API and/or Xendit).
3. Fix the client-facing total-amount drift (remove legacy 12%-tax-on-top model from the booking detail screen).
4. Commit the three pending Prisma migrations and get the merged schema reviewed.
5. Fix or remove the fabricated "AI Resume Analysis" screen.
6. Wire a real refund API call for captured CARD payments in the dispute-resolution path.
7. Recompute commission/tax/payout at capture time for quote-approved and add-on jobs.
8. Surface the real KYC rejection reason to workers.
9. Build a priced add-on catalog + picker UI.
10. Persist worker Digital ID fields (trade/serviceArea/licenseNumber) to the backend.
11. Close the KYC TOCTOU gap in `createBooking`'s transaction; rewire or remove the decorative `useWorkerCapacity` badge; add per-document KYC approve/reject; align env-var names; fix the admin `Payments.jsx` hardcoded 15% label; strengthen the contract's dispute/appeals section; delete confirmed-orphaned screens and inert dummy-data fixtures.
