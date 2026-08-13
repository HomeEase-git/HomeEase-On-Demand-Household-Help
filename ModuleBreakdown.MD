# Module Breakdown

Project split into testable modules, grouped by app. Use this to scope focused test passes instead of testing the whole app at once.

## Backend (`backend/src`)

| Module | Routes/Controllers | Services/Workers | Existing tests |
|---|---|---|---|
| Auth | `routes/auth.ts`, `controllers/authController.ts` | JWT, OTP password reset | — |
| Users/Profile | `routes/users.ts`, `controllers/userController.ts` | — | — |
| Workers | `routes/workers.ts`, `controllers/workerController.ts` | `services/workerAvailabilityService.ts` | — |
| Verification/KYC | `routes/verification.ts`, `controllers/verificationController.ts` | `services/verificationAiService.ts`, `services/resumeParseService.ts`, `workers/verificationWorker.ts`, `queues/verificationQueue.ts` | — |
| Bookings | `routes/bookings.ts`, `controllers/bookingController.ts` | `services/bookingStateMachine.ts`, `services/matchingService.ts`, `workers/bookingWorker.ts`, `queues/bookingQueue.ts` | `bookingStateMachine.test.ts`, `matchingService.test.ts`, `geo.test.ts` |
| Payments/Wallet | `routes/payments.ts`, `controllers/paymentController.ts`, `controllers/walletController.ts` | `services/paymentLifecycleService.ts`, `services/paymongoService.ts`, `services/paymongoDisbursementService.ts`, `services/walletService.ts`, `workers/payoutWorker.ts`, `queues/payoutQueue.ts` | — |
| Pricing | `routes/adminPricingRules.ts`, `controllers/pricingRuleController.ts` | `services/pricingRuleService.ts` | `pricingRuleService.test.ts` |
| Messaging | `routes/messages.ts`, `controllers/messageController.ts` | — | — |
| Notifications | `routes/notifications.ts`, `controllers/notificationController.ts` | `services/pushNotificationService.ts` | — |
| Service Catalog | `routes/services.ts`, `controllers/serviceController.ts` | — | — |
| Uploads | `controllers/uploadController.ts` | — | — |
| Admin Suite (analytics, audit logs, bookings, dashboard, disputes, payments, pricing, reports, reviews, service types, settings, users, verifications) | `routes/admin*.ts`, `controllers/admin*Controller.ts` | `services/appSettingsService.ts` | — |

**Gap:** payments/wallet, verification, and messaging modules have zero unit tests — biggest opportunity for coverage.

## Mobile (`mobile/app`, Expo Router)

| Module | Route group | Supporting code |
|---|---|---|
| Auth | `(auth)/` — sign-in, sign-up, OTP, password reset | `store/authStore.ts` |
| Onboarding/Role Select | `(onboarding)/`, `role-selection.tsx`, `landing.tsx` | — |
| KYC (worker verification) | `(kyc)/` — documents, selfie, resume, contract, pending/approved/rejected | resume/document utils in `mobile/utils` |
| Client — Home/Search | `(client)/home/`, `(client)/category/` | `store/searchStore.ts` |
| Client — Booking | `(client)/booking/` (4-step flow, track, quote, cancel) | `store/bookingStore.ts`, `components/booking4step/` |
| Client — Inbox/Chat | `(client)/inbox/` | `store/messageStore.ts`, `services/socket.ts` |
| Client — Profile/Payments | `(client)/profile/` (addresses, payment methods, transactions, reviews) | — |
| Worker — Home/Requests | `(worker)/home/`, `(worker)/requests/` | `store/workerStore.ts` |
| Worker — Records | `(worker)/records/` | — |
| Worker — Earnings/Payout | `(worker)/earnings/` (wallet, payout, breakdown) | — |
| Worker — Profile | `(worker)/profile/` (certifications, skills, digital-id) | `store/workerProfileStore.ts` |
| Worker — Inbox | `(worker)/inbox/` | shared with client messaging |
| Cross-cutting: Notifications | `inbox/notification/*` in both groups | `store/notificationStore.ts`, `services/notificationService.ts` |
| Cross-cutting: Offline/Location | — | `services/offline-sync.ts`, `services/location.ts` |
| Utils/Hooks (unit-tested) | — | `mobile/utils/__tests__/*`, `mobile/hooks/__tests__/*` (validators, formValidation, digitalId, imageCompressor, storageCrud, apiErrorHandling) |

## Web Admin Dashboard (`web/src/pages`)

| Module | Pages |
|---|---|
| Dashboard/Analytics | Dashboard.jsx, Analytics.jsx |
| Bookings | Bookings.jsx, BookingDetail.jsx, BookingDispute.jsx |
| Payments/Payouts | Payments.jsx, Payouts.jsx, Refunds.jsx, TransactionDetail.jsx |
| Pricing | PriceControl.jsx |
| Reviews | Reviews.jsx, ReviewsFlagged.jsx, ReviewDetail.jsx |
| Service Catalog | ServiceCatalog.jsx |
| Users/Clients/Workers | Users.jsx, ClientDetail.jsx, WorkerDetail.jsx, Workers.jsx |
| Verification | Verification.jsx, VerificationDetail.jsx |
| Reports/Settings | Reports.jsx, Settings.jsx |
| Auth | Login.jsx |

## Shared

- `shared/api-client` — cross-platform API types/client
- `shared/constants` — shared enums/constants

## Suggested Test Priority

Given current gaps: backend payments/wallet and verification have no tests despite being flagged Blocking-severity in the 2026-08-04 production audit — start there, then admin controllers (also untested), then expand mobile component/screen tests beyond the current utils/hooks coverage.
