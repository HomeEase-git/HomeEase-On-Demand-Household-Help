# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HomeEase is an on-demand household-help marketplace for the Philippines (clients book verified workers). There is no root `package.json`; each unit is its own npm project with its own `node_modules` and lockfile.

| Dir | Stack | Deployed to |
|-----|-------|-------------|
| `backend/` | Express 5 + TypeScript, Prisma 7 (Postgres/Neon), BullMQ (Redis), Socket.IO | Render (`render.yaml`, `backend/Dockerfile`) |
| `mobile/` | Expo / React Native (expo-router, Zustand, NativeWind), one app for both clients and workers | EAS (`mobile/eas.json`) |
| `web/` | Vite + React (JS, not TS): the admin dashboard | Vercel (`web/vercel.json`) |
| `shared/` | Framework-agnostic API client + enum constants (used by `web/src/services/apiClient.js`) | — |

`DEPLOY.md` covers hosting, and `docs/` covers secrets, monitoring, data resilience and incident response. Env vars are documented in each unit's `.env.example`; `.env` files are gitignored.

## Commands

### Backend (`cd backend`, Node 22+; the Supabase client needs native WebSocket)
```
npm run dev                  # nodemon + ts-node with tsconfig path aliases
npm run redis:dev            # local Redis for BullMQ
npx tsc --noEmit             # typecheck src
npm run typecheck:tooling    # typecheck scripts/ + prisma seeds
npm run build                # tsc + tsc-alias (rewrites @aliases in dist/)
npm test                     # full jest suite, needs a real Postgres in DATABASE_URL
npm run test:unit            # tests/unit only (pure, mostly no DB)
npm run test:queues          # tests/integration: real BullMQ against redis-memory-server
npx jest tests/bookingFlow.test.ts --runInBand        # single file
npx jest tests/unit/geo.test.ts -t "name of test"     # single test
npm run prisma:migrate       # prisma migrate dev (create migration); uses DIRECT_URL
npx prisma generate
npm run neon:branch          # create/switch a per-session Neon branch and rewrite DATABASE_URL/DIRECT_URL
```
CI (`.github/workflows/ci.yml`) runs, in order: `npm audit --omit=dev --audit-level=high`, `prisma migrate deploy`, `scripts/db-roles.ts`, `tsc --noEmit`, `typecheck:tooling`, `build`, `npm test` **as the least-privilege `homeease_app` DB role**, then `test:queues`. Locally, `tests/setupEnv.ts` loads `backend/.env` and disables rate limiting and the HIBP check.

### Mobile (`cd mobile`)
```
npm start                    # expo start --go
npx tsc --noEmit
npm run lint                 # expo lint
npm test                     # jest (jest-expo); single file: npx jest path/to/file.test.tsx
```
`EXPO_PUBLIC_API_URL` must be a LAN IP (not localhost) for a physical device. EAS builds take env from `eas.json` profiles plus expo.dev environment variables (e.g. `GOOGLE_MAPS_ANDROID_API_KEY`).

### Web (`cd web`)
```
npm run dev / npm run build  # Vite; no tests or lint configured
```

### Full stack
`docker compose up --build` (needs `backend/.env`) runs Postgres + Redis + API (:3000) + admin web (:8080).

## Backend architecture

- **Entry:** `src/index.ts` boots env checks (`config/envCheck.ts`), the DB privilege check, Sentry (`instrument.ts`, imported first), the HTTP server, Socket.IO (`socket.ts`), and the three BullMQ workers **in-process**. It also registers repeatable jobs and sets DNS to `ipv4first` (Render/Neon IPv6 issue). `src/app.ts` builds the Express app (route mounting, CORS, helmet, rate limits) without listening, so tests import it with supertest.
- **Layering:** `routes/` (validation + `middleware/auth.ts` / `role.ts`) → `controllers/` → `services/` → Prisma (`config/database.ts`). Admin endpoints are separate `admin*` route/controller files. Imports use path aliases (`@config/*`, `@services/*`, `@queues/*`, …) defined in `tsconfig.json` and mirrored in both jest configs. Add any new alias in all three places.
- **Response boundary:** `middleware/protectResponseData.ts` wraps `res.json` so private Supabase bucket URLs become short-lived signed URLs and encrypted fields (payout account numbers, TINs via `utils/fieldEncryption.ts` + `DATA_ENCRYPTION_KEY`) are masked. Controllers return raw records and rely on this.
- **Booking lifecycle:** `services/bookingStateMachine.ts` is the single source of allowed `BookingStatus` transitions (pure, unit-tested). Flow: PENDING → ACCEPTED → IN_PROGRESS → QUOTE_SUBMITTED → QUOTE_APPROVED → PENDING_COMPLETION → (AWAITING_PAYMENT for GCash/Maya via Xendit invoice | COMPLETED for cash). DECLINED/QUOTE_DISPUTED don't exist (use REJECTED/DISPUTED).
- **Background jobs:** `queues/` (bookingQueue, payoutQueue, verificationQueue) + `workers/`. Booking sweeps (timeouts, no-shows, dispute SLA, KYC expiry, auto-suspend, data retention) are repeatable jobs with stable jobIds. Don't use `:` in custom jobIds; BullMQ rejects them. On Render's free tier the process sleeps, so `.github/workflows/cron-sweeps.yml` hits `POST /internal/cron/:task` (header `x-cron-secret`) and `keep-alive.yml` pings it. In the default jest suite, the queue modules are replaced by `tests/mocks/*`.
- **Money:** `services/ledgerService.ts` is a double-entry ledger in **whole centavos** (integers). Each money event posts one balanced transaction under a unique idempotency key, so webhook retries can't double-post. Payments and payouts go through Xendit (`xenditService.ts` for invoices, `xenditDisbursementService.ts` for payouts, with webhooks in `routes/payments.ts`). Commission and withholding-tax rates live in the admin-editable `AppSettings` DB row (`appSettingsService`). The env values are only fallbacks.
- **External services:** Supabase storage (buckets created on boot by `utils/ensureStorageBuckets.ts`), Google Places/Routes (server key only; the backend is the only map data provider), Brevo/SMTP/Gmail-API email (`EMAIL_PROVIDER`), PhilSMS, Anthropic (resume parsing + KYC review in `verificationAiService.ts`, which degrades to a heuristic when there's no key), and Expo push.
- **Auth:** short-lived JWT (`JWT_EXPIRY` is plain **seconds**, not `"15m"`) plus a refresh flow (`/auth/refresh`, `sessionService.ts`). Admins have TOTP MFA (secrets encrypted with `MFA_ENCRYPTION_KEY`).
- **DB:** schema is in `prisma/schema.prisma`, and migrations are applied by `docker-entrypoint.sh` (`prisma migrate deploy`) on every deploy. Production runs as a restricted role that cannot alter the schema or edit audit-log/ledger rows. Tests clean those up through `DIRECT_URL` (`tests/ownerDb.ts`). Test users get `e2etest` in their email (`tests/helpers.ts`).
- `backend/openapi.yaml` documents the REST API. The `_probe*.js` / `_fix_*.js` files at the backend root are ad-hoc scripts, not part of the app.

## Mobile architecture

- expo-router route groups in `app/`: `(auth)`, `(onboarding)`, `(kyc)` (worker verification flow), `(client)`, `(worker)`. Root `_layout.tsx` / `index.tsx` route by auth state and role.
- `services/api.ts` is the axios instance (base `${API_URL}/api`, with token refresh in an interceptor). `services/socket.ts` handles realtime, and `offline-sync.ts` / `notificationService.ts` handle offline sync and push. State lives in Zustand stores in `store/` (`authStore`, `bookingStore`, `messageStore`).
- The map display uses a separate Android-restricted Google key, read at build time in `app.config.ts`.
