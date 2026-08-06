# Test Cases Draft — Core Features (Mobile App + Admin Web)

Draft functional test cases for HomeEase's main user journeys: registration/authentication,
KYC onboarding, booking, worker job handling, payments, chat, reviews, and admin management.
Status column is for QA to fill in as cases are run.

Legend: **P** = Priority (P0 blocker, P1 high, P2 medium)

---

## A. Authentication (Client & Worker)

| ID      | Priority | Preconditions                     | Steps                                                                         | Expected Result                                                                                                 | Status |
| ------- | -------- | --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| AUTH-01 | P0       | New user on role selection screen | Choose "Client" role, complete registration with valid email/password/details | Account created, OTP sent for verification                                                                      |        |
| AUTH-02 | P0       | New user                          | Choose "Worker" role, complete registration                                   | Account created and routed into KYC onboarding, not straight into the worker dashboard                          |        |
| AUTH-03 | P0       | Registration submitted            | Enter correct OTP on the verification screen                                  | Account verified, success confirmation shown, user proceeds                                                     |        |
| AUTH-04 | P1       | Registration submitted            | Enter incorrect OTP (multiple attempts)                                       | Clear error, no crash, retry/resend available                                                                   |        |
| AUTH-05 | P1       | On registration screen            | Submit with an email already registered                                       | Clear "already exists" error, no duplicate account created                                                      |        |
| AUTH-06 | P1       | On registration screen            | Submit with a weak password or mismatched confirm-password                    | Validation error shown before submission                                                                        |        |
| AUTH-07 | P0       | Verified account                  | Sign in with correct email/password                                           | Routed to the correct home dashboard based on role (client or worker)                                           |        |
| AUTH-08 | P0       | Verified account                  | Sign in with wrong password                                                   | Clear error, no account-lockout details leaked, no crash                                                        |        |
| AUTH-09 | P1       | Unverified account                | Sign in before completing OTP verification                                    | Blocked/redirected to verification step, not allowed into the app                                               |        |
| AUTH-10 | P0       | Signed-in user                    | Tap "Forgot password", request a reset OTP                                    | OTP sent, confirmation screen shown                                                                             |        |
| AUTH-11 | P0       | Reset OTP received                | Enter correct OTP, set a new password                                         | Password updated; login works with new password, fails with old                                                 |        |
| AUTH-12 | P1       | On password reset screen          | Enter an expired or already-used OTP                                          | Rejected with a clear error                                                                                     |        |
| AUTH-13 | P2       | Signed-in user                    | Change password from account settings (client & worker)                       | Requires current password; new password takes effect immediately                                                |        |
| AUTH-14 | P1       | Signed-in user                    | Accept/decline Terms & Conditions during registration                         | Cannot proceed without accepting terms                                                                          |        |
| AUTH-15 | P1       | Signed-in user                    | Sign out                                                                      | Session/token cleared, redirected to sign-in, protected screens no longer accessible                            |        |
| AUTH-16 | P1       | Signed-in user                    | Force-close and reopen the app                                                | Session persists (stays logged in) unless token has expired                                                     |        |
| AUTH-17 | P2       | Client or worker                  | Delete account from account settings                                          | Confirmation required; account deactivated/deleted; user logged out; cannot sign in again with same credentials |        |

## B. Worker KYC (Identity Verification) Onboarding

| ID     | Priority | Preconditions                           | Steps                                                                                 | Expected Result                                                                                        | Status |
| ------ | -------- | --------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| KYC-01 | P0       | New worker account                      | Start the identity verification flow                                                  | Guided through document upload steps in order                                                          |        |
| KYC-02 | P0       | On ID upload step                       | Upload a valid government ID (photo/PDF)                                              | File accepted, preview shown, proceeds to next step                                                    |        |
| KYC-03 | P1       | On ID upload step                       | Upload an invalid file type or oversized file                                         | Clear validation error, upload blocked                                                                 |        |
| KYC-04 | P0       | On selfie step                          | Capture/upload a selfie for liveness check                                            | Selfie accepted and attached to the verification submission                                            |        |
| KYC-05 | P0       | On additional documents step            | Upload required supporting documents (certifications, etc.)                           | All required documents tracked; cannot submit until required ones are present                          |        |
| KYC-06 | P1       | On resume upload step                   | Upload a resume (PDF)                                                                 | Resume parsed and preview populated with real extracted data (skills/experience), not placeholder data |        |
| KYC-07 | P1       | On resume upload step                   | Upload a corrupted or non-PDF file                                                    | Clear error state, no crash                                                                            |        |
| KYC-08 | P1       | On contract step                        | Review and accept the worker contract/terms                                           | Cannot proceed to submission without accepting                                                         |        |
| KYC-09 | P0       | All verification steps completed        | Submit the application                                                                | Status moves to "pending review"; worker cannot access job requests yet                                |        |
| KYC-10 | P0       | Verification submitted                  | Admin approves the application                                                        | Worker status becomes approved; worker gains access to job requests and dashboard                      |        |
| KYC-11 | P0       | Verification submitted                  | Admin rejects with a reason                                                           | Worker sees the specific rejection reason; can resubmit corrected documents                            |        |
| KYC-12 | P0       | Worker authenticated                    | Attempt to set own verification/approval status directly via a profile update request | Rejected — worker cannot self-approve their own verification (security check)                          |        |
| KYC-13 | P2       | Verification pending                    | Worker attempts to accept jobs before approval                                        | Blocked from worker-only actions until approved                                                        |        |
| KYC-14 | P1       | Verification rejected, then resubmitted | Admin reviews the resubmission                                                        | New submission correctly replaces/updates the prior rejected state                                     |        |

## C. Client — Browsing & Discovery

| ID      | Priority | Preconditions            | Steps                                                  | Expected Result                                                 | Status |
| ------- | -------- | ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------- | ------ |
| DISC-01 | P0       | Client signed in         | Open the home screen                                   | Categories/featured workers load correctly                      |        |
| DISC-02 | P1       | Client on home screen    | Search for a service or worker                         | Relevant results returned; empty state shown for no matches     |        |
| DISC-03 | P0       | Client on home screen    | Tap a service category                                 | List of workers/services for that category shown                |        |
| DISC-04 | P0       | Viewing a category       | Tap a worker                                           | Worker profile shows bio, packages, ratings, availability       |        |
| DISC-05 | P1       | Viewing a worker profile | Open their reviews                                     | List of client reviews with ratings shown, paginated/scrollable |        |
| DISC-06 | P1       | Search/browse            | Filter by location, price, availability (if supported) | Results correctly filtered and matched                          |        |
| DISC-07 | P2       | Client browsing          | Worker is at maximum job capacity                      | Worker shown as unavailable/not bookable in real time           |        |

## D. Client — Booking Flow

| ID      | Priority | Preconditions                                     | Steps                                                                                | Expected Result                                                                                                            | Status |
| ------- | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| BOOK-01 | P0       | Client viewing a worker/service                   | Start booking — service/details step                                                 | Required fields validated before proceeding                                                                                |        |
| BOOK-02 | P0       | Service details entered                           | Select date/time/address                                                             | Cannot proceed without a valid schedule and address; conflicting/past dates rejected                                       |        |
| BOOK-03 | P1       | Schedule/address entered                          | Select add-ons/packages                                                              | Selected packages correctly added; price preview updates                                                                   |        |
| BOOK-04 | P0       | Add-ons selected                                  | Review booking summary and choose payment method                                     | Final price shown matches the server-computed total (subtotal + add-ons + tip), not a client-side guess                    |        |
| BOOK-05 | P0       | Review step                                       | Confirm and submit the booking                                                       | Booking created server-side; selected packages and price are validated and resolved server-side regardless of client input |        |
| BOOK-06 | P1       | Submitting booking                                | Tamper with the client-side total price before submitting (e.g. intercepted request) | Server ignores tampered price; uses its own authoritative calculation                                                      |        |
| BOOK-07 | P0       | Booking submitted, payment method = card          | Complete payment                                                                     | Payment authorized/captured appropriately; confirmation screen shown                                                       |        |
| BOOK-08 | P0       | Booking submitted, payment method = GCash/Maya    | Complete payment                                                                     | E-wallet charged upfront correctly; booking confirmed                                                                      |        |
| BOOK-09 | P1       | Payment fails (declined card, insufficient funds) | Attempt payment                                                                      | Clear failure message; booking not left in a confusing partial state                                                       |        |
| BOOK-10 | P0       | Booking confirmed                                 | Open booking details                                                                 | Booking status and worker info shown correctly                                                                             |        |
| BOOK-11 | P0       | Booking in progress                               | Open live tracking for the booking                                                   | Status/location updates correctly                                                                                          |        |
| BOOK-12 | P1       | Worker sends a price adjustment                   | Client views the updated quote                                                       | Client can view and accept/decline the quote change; price updates flow correctly                                          |        |
| BOOK-13 | P1       | Booking not yet started                           | Client cancels the booking                                                           | Cancellation reason captured; refund/void logic triggered per cancellation policy                                          |        |
| BOOK-14 | P2       | Booking cancelled close to start time             | Attempt cancellation                                                                 | Cancellation fee/policy correctly applied if configured                                                                    |        |
| BOOK-15 | P0       | Booking completed                                 | Payment captured                                                                     | Commission/tax/payout recomputed against live rates and the real final price at capture time                               |        |
| BOOK-16 | P1       | Booking completed                                 | Client prompted to rate/review                                                       | Review submission tied correctly to the specific booking and worker                                                        |        |
| BOOK-17 | P2       | Client has no bookings                            | Open the bookings list                                                               | Empty state shown, no crash                                                                                                |        |
| BOOK-18 | P1       | Client has multiple bookings (active/past)        | Open the bookings list                                                               | Correctly separated/filterable by status (upcoming, ongoing, completed, cancelled)                                         |        |

## E. Client — Profile & Account

| ID       | Priority | Preconditions                | Steps                                                         | Expected Result                                                        | Status |
| -------- | -------- | ---------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| CPROF-01 | P1       | Client signed in             | Edit profile details                                          | Changes saved and reflected immediately                                |        |
| CPROF-02 | P1       | Client signed in             | Add/edit/delete a saved address                               | Addresses persist and appear as selectable options in the booking flow |        |
| CPROF-03 | P0       | Client signed in             | Add a payment method                                          | Card/e-wallet tokenized and saved securely (no raw card data stored)   |        |
| CPROF-04 | P1       | Saved payment methods exist  | Edit/delete a payment method                                  | Deleted method no longer selectable in the booking flow                |        |
| CPROF-05 | P1       | Client has past transactions | View transaction list, then a transaction's receipt           | List and receipt show accurate real data (no dummy/mock data)          |        |
| CPROF-06 | P2       | Client signed in             | Update notification preferences                               | Preferences persist and are respected by actual notification delivery  |        |
| CPROF-07 | P2       | Client signed in             | Update privacy settings                                       | Settings persist correctly                                             |        |
| CPROF-08 | P2       | Client signed in             | View About, Terms, Privacy Policy, Contact Us, Help & Support | Static/support content renders correctly, no broken links              |        |
| CPROF-09 | P1       | Client completed a booking   | Submit a rating/review for the worker                         | Review appears on the worker's public profile and reviews list         |        |

## F. Client — Inbox / Messaging

| ID      | Priority | Preconditions                           | Steps                             | Expected Result                                           | Status |
| ------- | -------- | --------------------------------------- | --------------------------------- | --------------------------------------------------------- | ------ |
| CHAT-01 | P0       | Active booking with an assigned worker  | Open the chat and send a message  | Message delivered and appears in the worker's inbox       |        |
| CHAT-02 | P1       | Chat has image attachments              | Open an image attachment          | Image displays correctly, can be dismissed                |        |
| CHAT-03 | P1       | New message received                    | Check the inbox/conversation list | List updates with latest message preview/unread indicator |        |
| CHAT-04 | P1       | New notification (booking update, etc.) | Open the notification detail      | Notification detail shown, marked as read                 |        |
| CHAT-05 | P2       | No conversations yet                    | Open the inbox                    | Empty state shown                                         |        |

## G. Worker — Job Requests & Records

| ID      | Priority | Preconditions                                            | Steps                       | Expected Result                                                                                      | Status |
| ------- | -------- | -------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| WREQ-01 | P0       | Worker approved (verified), new booking request comes in | Open the job requests list  | New request listed with correct client/booking details                                               |        |
| WREQ-02 | P0       | Pending request                                          | Open request detail, accept | Booking assigned to worker; client notified; request removed from the pending pool                   |        |
| WREQ-03 | P1       | Pending request                                          | Decline the request         | Request removed from the worker's queue; re-enters the matching pool for other workers if applicable |        |
| WREQ-04 | P1       | Accepted job                                             | Open job detail             | Job details (schedule, address, add-ons) shown accurately                                            |        |
| WREQ-05 | P1       | Job in progress, price needs adjustment                  | Submit a quote adjustment   | Quote sent to the client and reflected on their side                                                 |        |
| WREQ-06 | P0       | Worker at maximum concurrent jobs                        | New request arrives         | Worker not matched/shown new requests until capacity frees up                                        |        |
| WREQ-07 | P1       | Job completed                                            | Open job records            | Completed job appears in records with correct status/earnings                                        |        |
| WREQ-08 | P1       | Multiple past jobs                                       | Open a record's detail      | Detail view shows accurate booking/payment history                                                   |        |
| WREQ-09 | P2       | No active requests                                       | Open the requests screen    | Empty state shown                                                                                    |        |

## H. Worker — Earnings & Payouts

| ID      | Priority | Preconditions                                     | Steps                                         | Expected Result                                                                                   | Status |
| ------- | -------- | ------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| EARN-01 | P0       | Worker has completed paid jobs                    | Open the earnings screen                      | Total earnings reflect real captured payments minus commission/tax                                |        |
| EARN-02 | P1       | Earnings exist                                    | Open the earnings breakdown                   | Per-booking breakdown (subtotal, commission, tax, net) is accurate                                |        |
| EARN-03 | P1       | Specific transaction                              | Open transaction detail                       | Detail matches admin/payment records                                                              |        |
| EARN-04 | P0       | Worker has a GCash/Maya payout account configured | Payout triggered after job completion/capture | Payout disbursed correctly; status reflected in the payout screen                                 |        |
| EARN-05 | P1       | Worker edits their payout account                 | Change GCash/Maya account details             | Changes saved and used for the next payout                                                        |        |
| EARN-06 | P0       | Worker only has a bank account configured         | Payout triggered                              | Payout fails with a clear, tracked reason (bank payouts not yet supported) — not silently dropped |        |
| EARN-07 | P1       | A payout previously failed                        | Admin retries the payout                      | Payout retried; status updates correctly                                                          |        |
| EARN-08 | P2       | No earnings yet                                   | Open earnings screen                          | Empty state shown, no crash                                                                       |        |

## I. Worker — Profile & Availability

| ID       | Priority | Preconditions      | Steps                                                         | Expected Result                                                                     | Status |
| -------- | -------- | ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| WPROF-01 | P1       | Worker signed in   | Edit profile details                                          | Changes saved and reflected on the public worker profile                            |        |
| WPROF-02 | P0       | Worker signed in   | Set availability schedule                                     | Availability persists and correctly affects bookability in client search/booking    |        |
| WPROF-03 | P1       | Worker signed in   | Update Digital ID (trade, service area, license number)       | Values persist server-side; visible after logout/login or on another device         |        |
| WPROF-04 | P1       | Worker signed in   | Add/edit skills                                               | Skills saved and shown on the public profile                                        |        |
| WPROF-05 | P0       | Worker signed in   | Create/edit/delete a service package                          | Package CRUD succeeds for own packages only; visible to clients in the booking flow |        |
| WPROF-06 | P0       | Worker A           | Attempt to edit/delete Worker B's package (crafted request)   | Rejected — authorization enforced server-side                                       |        |
| WPROF-07 | P1       | Worker signed in   | Upload a certification                                        | Certification uploaded, listed, and viewable in detail                              |        |
| WPROF-08 | P1       | Worker signed in   | View resume preview after uploading a resume                  | Real parsed resume data shown, loading/empty/error states correct                   |        |
| WPROF-09 | P1       | Worker has reviews | Open worker reviews                                           | Reviews from clients listed accurately                                              |        |
| WPROF-10 | P2       | Worker signed in   | Rate a client (if supported)                                  | Rating submitted and tied to the correct booking                                    |        |
| WPROF-11 | P2       | Worker signed in   | View About, Terms, Privacy Policy, Contact Us, Help & Support | Static/support content renders correctly                                            |        |

## J. Admin — Authentication & Dashboard

| ID     | Priority | Preconditions                                    | Steps                           | Expected Result                                                           | Status |
| ------ | -------- | ------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------- | ------ |
| ADM-01 | P0       | Admin account exists                             | Log in with valid credentials   | Redirected to the admin dashboard                                         |        |
| ADM-02 | P0       | —                                                | Log in with invalid credentials | Clear error, no access granted                                            |        |
| ADM-03 | P1       | Admin logged in                                  | View the dashboard              | Key metrics (bookings, revenue, active workers, etc.) load with real data |        |
| ADM-04 | P1       | Admin logged in                                  | Session expires/token invalid   | Redirected to login, no stale data shown                                  |        |
| ADM-05 | P2       | Non-admin tries to access admin screens directly | Attempt navigation              | Blocked/redirected — authorization enforced                               |        |

## K. Admin — User & Worker Management

| ID      | Priority | Preconditions                       | Steps                                         | Expected Result                                                               | Status |
| ------- | -------- | ----------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| ADMU-01 | P0       | Admin logged in                     | Search/filter clients and workers             | Correct filtered results returned                                             |        |
| ADMU-02 | P1       | A client exists                     | Open client detail                            | Full client profile, booking history, transactions shown                      |        |
| ADMU-03 | P1       | A worker exists                     | Open worker detail                            | Full worker profile, verification status, jobs, earnings shown                |        |
| ADMU-04 | P1       | Admin viewing a user                | Suspend/deactivate a client or worker account | Account access revoked; user cannot log in or transact until reinstated       |        |
| ADMU-05 | P0       | Worker pending verification         | Open the verification queue                   | Pending workers listed correctly                                              |        |
| ADMU-06 | P0       | Worker verification submission open | Review submitted documents                    | Approve/reject per document and overall; rejection reason required and stored |        |
| ADMU-07 | P0       | Worker approved                     | Verify worker gains job-request access        | Reflected immediately in the mobile app                                       |        |

## L. Admin — Bookings & Disputes

| ID      | Priority | Preconditions             | Steps                          | Expected Result                                                                                  | Status |
| ------- | -------- | ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ | ------ |
| ADMB-01 | P0       | Bookings exist            | Filter bookings by status/date | Correct filtered list returned                                                                   |        |
| ADMB-02 | P1       | A booking exists          | Open booking detail            | Full booking timeline, payment, and worker/client info shown accurately                          |        |
| ADMB-03 | P1       | A dispute is raised       | Open the dispute detail        | Dispute details shown; admin can resolve/respond                                                 |        |
| ADMB-04 | P1       | Dispute resolved by admin | Confirm the resolution action  | Booking/payment state updates consistently with the resolution (refund, payout adjustment, etc.) |        |

## M. Admin — Payments, Payouts, Refunds, Pricing

| ID      | Priority | Preconditions                     | Steps                                               | Expected Result                                                                                   | Status |
| ------- | -------- | --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| ADMP-01 | P0       | Payments exist                    | Open the payments list                              | List accurate; commission percentage derived from real data, not hardcoded                        |        |
| ADMP-02 | P1       | A transaction exists              | Open transaction detail                             | Full breakdown matches what the client/worker see                                                 |        |
| ADMP-03 | P0       | Captured payment                  | Issue a refund                                      | Real refund triggered through the payment provider; works for both card and e-wallet (GCash/Maya) |        |
| ADMP-04 | P0       | Completed bookings pending payout | Open the payouts list                               | Payout statuses accurate (pending/success/failed)                                                 |        |
| ADMP-05 | P0       | A payout failed                   | Retry the payout                                    | Retry triggers a new disbursement attempt; status updates                                         |        |
| ADMP-06 | P1       | Admin logged in                   | Update commission/tax rate settings                 | New rates take effect for future captures (not retroactively for already-captured payments)       |        |
| ADMP-07 | P2       | Rates just changed                | A booking is captured shortly after the rate change | Correct rate applied — verifies the rate is read at capture time, not cached                      |        |

## N. Admin — Catalog, Reviews, Analytics, Settings

| ID      | Priority | Preconditions       | Steps                             | Expected Result                                                                                 | Status |
| ------- | -------- | ------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| ADMC-01 | P1       | Admin logged in     | Manage service categories/catalog | CRUD works; changes reflected in the mobile app's category browsing                             |        |
| ADMR-01 | P1       | Reviews exist       | View reviews list and detail      | Accurate review data and moderation actions available                                           |        |
| ADMR-02 | P1       | A review is flagged | Open flagged reviews              | Flagged reviews listed; admin can approve/remove                                                |        |
| ADMA-01 | P2       | Admin logged in     | View analytics/reports            | Charts/reports reflect real aggregated data                                                     |        |
| ADMS-01 | P2       | Admin logged in     | Update platform settings          | Settings persist and affect relevant behavior (e.g., commission rate feeding into live pricing) |        |

---

## Cross-Cutting Checks

| ID    | Priority | Area                    | Steps                                                                          | Expected Result                                                   | Status |
| ----- | -------- | ----------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------ |
| XC-01 | P0       | Security                | Attempt any worker-only or client-only action from the wrong role's session    | Rejected, not silently allowed                                    |        |
| XC-02 | P0       | Security                | Attempt to access another user's booking/profile/transaction by guessing IDs   | Rejected — ownership enforced server-side                         |        |
| XC-03 | P1       | Reliability             | Lose network connection mid-booking-submission or mid-payment                  | No duplicate bookings/charges created; app recovers gracefully    |        |
| XC-04 | P1       | Consistency             | Compare the price shown to client, worker, and admin for the same booking      | All three show the same server-computed values                    |        |
| XC-05 | P2       | Localization/formatting | Currency and date formatting across mobile and web                             | Consistent formatting throughout the app                          |        |
| XC-06 | P2       | Empty/error states      | For every major list screen (bookings, requests, transactions, reviews, chats) | Empty state and network-error state both handled without crashing |        |

## Next Steps

- Assign owners per section (A–N) and fill in Status (Pass/Fail/Blocked).
- Prioritize automating P0 cases first: authentication, verification approval gating, booking submission/pricing, payment capture, payout dispatch.
- Areas with limited or no automated test coverage today: worker package authorization, payout dispatch/retry, resume parsing, admin bookings/disputes, admin payments/payouts/refunds screens.
