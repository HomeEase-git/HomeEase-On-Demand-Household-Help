# Deploying HomeEase

Three deployable units plus two backing stores:

| Unit | Tech | Artifact | Serves |
|------|------|----------|--------|
| **backend** | Express 5 + Prisma 7 + BullMQ + Socket.IO | `backend/Dockerfile` → container | REST API `/api/*`, websockets, background workers |
| **web** | Vite + React (admin dashboard) | `web/Dockerfile` → nginx container (static) | Admin UI |
| **mobile** | Expo / React Native | EAS build → `.apk` / store binary | Clients & workers |
| Postgres 16 | — | managed (Neon, RDS, …) or the Compose container | primary datastore |
| Redis 7 | — | managed (Upstash, Elasticache, …) or the Compose container | BullMQ job queues |

The backend **requires** both Postgres and Redis. Without Redis it still answers
HTTP, but every background flow silently stops: payout disbursement, the 72h
overdue-payment → auto-dispute sweep, quote / completion timeouts, and payment
reminders. Treat Redis as a hard dependency and watch `GET /health/ready`.

---

## 1. Provision first

- **Postgres 16** — you need two connection strings (they can be identical if
  you are not using a pooler): `DATABASE_URL` (pooled, used at runtime) and
  `DIRECT_URL` (unpooled, used by `prisma migrate deploy`).
- **Redis 7** — host, port, password.
- **Supabase** project + storage buckets: `kyc-documents`, `resumes`,
  `chat-images`, `avatars`, `booking-photos`, `tax-certificates` (the backend
  calls `ensureStorageBuckets()` on boot and will create missing ones if the
  service key allows it).
- **Xendit** — a **live** secret key (`xnd_production_…`) and a webhook token.
  Point the Xendit dashboard webhook at `https://<api-domain>/api/payments/webhook/xendit`
  (confirm the exact path in `backend/src/routes/payments.ts`).
- **SMTP** (Gmail app password) and **PhilSMS** token + approved sender ID.
- **Anthropic API key** (resume parsing / KYC assist) — optional; leave blank to disable.
- **DNS** — e.g. `api.example.com` → backend, `admin.example.com` → web.

## 2. Backend

### Environment
Copy `backend/.env.example` → real values in your platform's secret store. The
deployment-specific ones:

| Var | Set to |
|-----|--------|
| `NODE_ENV` | `production` |
| `PORT` | platform's injected port (or `3000`) |
| `APP_URL` | public API URL, e.g. `https://api.example.com` |
| `DATABASE_URL` / `DIRECT_URL` | pooled / unpooled Postgres URLs |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | managed Redis |
| `ALLOWED_ORIGINS` | comma-separated: admin web origin + any others (mobile needs none) |
| `TRUST_PROXY` | `1` behind a single proxy / PaaS router |
| `JWT_SECRET` | long random string |
| `XENDIT_SECRET_KEY` / `XENDIT_WEBHOOK_TOKEN` / `XENDIT_REDIRECT_BASE_URL` | live values |
| `COMMISSION_RATE` / `WITHHOLDING_TAX_RATE` | fallback only; live values are the `AppSettings` row |

### Build & run
```
docker build -t homeease-backend ./backend
docker run --env-file backend/.env -p 3000:3000 homeease-backend
```
The image entrypoint runs `prisma migrate deploy` before starting the server
(`migrate deploy` is idempotent and lock-guarded, so parallel instance starts
are safe). To run migrations as a separate release step instead, set
`RUN_MIGRATIONS=false` and run `npx prisma migrate deploy` yourself in a
one-off task.

### Probes
- **Liveness:** `GET /health` → `200 {"status":"OK"}` (no dependencies touched).
- **Readiness:** `GET /health/ready` → `200` when Postgres is reachable, `503`
  otherwise. Gate rollout traffic on this.

### Shutdown
The server drains on `SIGTERM`/`SIGINT`: stops accepting connections, finishes
in-flight requests, closes websockets + BullMQ workers/queues, disconnects
Prisma, then exits. Budget is `SHUTDOWN_TIMEOUT_MS` (default 15s) — keep it
below the platform's kill grace period.

### First-run data
The image does not ship seeds. After the first deploy, create via the admin
dashboard (or a one-off `npm run prisma:seed:complete` against the prod DB):
service types, pricing rules, and the `AppSettings` row (commission +
withholding rate). Create the first `ADMIN` user directly in the DB or with a
seed script.

## 3. Web (admin dashboard)

Build context is the **repo root** (imports `../shared`):
```
docker build -f web/Dockerfile -t homeease-web .
docker run -e BACKEND_URL=https://api.example.com -p 8080:8080 homeease-web
```
- `VITE_API_URL` (build arg, default `/api`) — leave as `/api` to use the
  bundled nginx reverse proxy; the container proxies `/api/*` to `BACKEND_URL`
  (runtime env). Same-origin, so no CORS entry needed for the web app.
- For a pure static/CDN host instead: `cd web && VITE_API_URL=https://api.example.com npm run build`
  and upload `web/dist/` — then add that origin to the backend `ALLOWED_ORIGINS`.

## 4. Mobile

`mobile/eas.json` carries `EXPO_PUBLIC_API_URL` per profile — **replace the
`REPLACE_ME` placeholders** with the real staging / production API domains
(must be `https://`, no trailing slash).
```
cd mobile
eas build --profile production --platform android
```
`app.json` is already set: package `com.homeease.app`, EAS project linked,
camera / location permission strings present.

## 5. All-in-one (single VPS / local rehearsal)

```
cp backend/.env.example backend/.env    # fill in real secrets
docker compose up --build
```
Brings up Postgres + Redis + backend (auto-migrated) + web. Admin on
`http://localhost:8080`, API on `http://localhost:3000`. Compose overrides
`DATABASE_URL` / `REDIS_HOST` to the container services regardless of what
`backend/.env` says; secrets still come from `backend/.env`.

## 6. Post-deploy smoke test

1. `curl https://api.example.com/health` → `200`
2. `curl https://api.example.com/health/ready` → `200`
3. Admin dashboard loads, login works.
4. `prisma migrate status` against the prod DB → "up to date".
5. Register a client + worker on mobile against the prod API.
6. Run one full booking → completion → **payment** cycle end to end and
   confirm the Xendit invoice + payout land. This path has not been exercised
   against live Xendit yet — do it in a controlled test before real traffic.
7. Kill Redis briefly and confirm the API stays up (`/health` 200) while
   `/health/ready` still reports the DB fine; restore Redis, confirm workers
   reconnect.

---

## Not done yet (do before real users)

- **CI on the deploy branch.** CI only runs on `main`; the last `main` run
  failed on `npm test`. Get a green pipeline on whatever branch you ship.
- **Live payment verification.** The pay-after-completion flow (invoice →
  `AWAITING_PAYMENT` → payout with debt-netting → 72h auto-dispute) has never
  run against real Xendit. Step 6 above is mandatory.
- **Structured logging.** Everything is `console.*`. Add a real logger + log
  aggregation before you need to debug production.
- **Error tracking / metrics / uptime alerting.** None wired.
- **Backups.** Confirm automated Postgres backups + a tested restore.
- **Secrets rotation.** `JWT_SECRET` rotation invalidates all sessions — plan for it.
- **Load test** the rate-limit ceilings (`RATE_LIMIT_*`) against expected traffic.
