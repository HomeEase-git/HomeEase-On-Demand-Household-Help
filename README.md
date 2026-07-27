# HomeEase — Monorepo

One backend serves both the web admin dashboard and the mobile app.

## Quick start

```bash
# Backend (API — serves both web and mobile)
cd backend && npm install && cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, etc.
npm run prisma:generate && npm run prisma:migrate
npm run dev                                          # http://localhost:3000

# Web (admin dashboard)
cd web && npm install && npm run dev                 # http://localhost:5173, proxies /api -> :3000

# Mobile (Expo)
cd mobile && npm install && npx expo start
```

**Admin login:** seed an admin account first — see `backend/prisma/seeds/seed-admin.ts`
(defaults to `admin@homeease.dev` / `ChangeMe123!`, override via `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars).

### Login shows "Internal server error"?

1. Check `backend/.env` exists and `DATABASE_URL`/`JWT_SECRET` are set.
2. Run `npm run prisma:generate` inside `backend` if you just pulled schema changes — a stale generated
   Prisma Client is a common cause of confusing type/runtime errors after a schema change.
3. **Restart the backend** — stop the old terminal (Ctrl+C), then `npm run dev` again.
4. Backend must be running at **http://localhost:3000** before logging in on the admin site.
5. The AI-assisted KYC verification pipeline needs Redis (`REDIS_HOST`/`REDIS_PORT`) — the API still
   works without it, but verification review jobs won't process.

## Project structure

```
backend/   Express + Prisma API — auth, bookings, payments, messaging, admin console, KYC verification
web/       React admin dashboard (Vite) — talks to backend/ under /api/admin/* and /api/verification/*
mobile/    Expo/React Native client app — talks to the same backend/ under /api/*
shared/    API client + constants shared between web and mobile
```
