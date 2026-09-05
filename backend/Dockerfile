# syntax=docker/dockerfile:1
# Build context is the backend/ directory:  docker build -t homeease-backend backend/

# ---------- base ----------
FROM node:22-bookworm-slim AS base
# openssl: required by the Prisma query engine. dumb-init: PID 1 signal
# forwarding + zombie reaping.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

# `prisma generate` only reads the schema (no DB connection), but
# prisma.config.ts resolves DIRECT_URL via Prisma's env() helper, which
# throws — PrismaConfigEnvError — if the var is simply unset. There's no
# real DATABASE_URL/DIRECT_URL at build time (.env is dockerignored on
# purpose, so no secret ever lands in an image layer), so both `generate`
# steps below inject a syntactically-valid placeholder as a one-off RUN env
# rather than an ENV/ARG default: it never persists into an image layer or
# leaks into the running container, where the platform's real value takes
# over for `migrate deploy` at start.
ARG PRISMA_GENERATE_DB_URL=postgresql://build:build@localhost:5432/build

# ---------- build ----------
FROM base AS build
ARG PRISMA_GENERATE_DB_URL
ENV NODE_ENV=development
COPY package.json package-lock.json ./
# redis-memory-server (devDep, only used by tests/integration — never runs
# in this image) postinstalls by compiling Redis from source via `make`,
# which this slim base image doesn't have. Its own opt-out var skips that;
# the image never needs the binary since it talks to a real Redis at
# runtime.
RUN REDISMS_DISABLE_POSTINSTALL=1 npm ci
COPY . .
# generate the Prisma client (so tsc sees its types), then compile TS ->
# dist/ and rewrite the @/* path aliases (tsc-alias) so dist/ can run under
# plain node.
RUN DATABASE_URL=$PRISMA_GENERATE_DB_URL DIRECT_URL=$PRISMA_GENERATE_DB_URL \
  npx prisma generate && npm run build

# ---------- runtime ----------
FROM base AS runtime
ARG PRISMA_GENERATE_DB_URL
# Production dependencies only. `prisma` is a runtime dep here because the
# entrypoint runs `prisma migrate deploy`.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Prisma schema + config are needed both to (re)generate the client for
# this image's exact engine and to run migrations at start.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL=$PRISMA_GENERATE_DB_URL DIRECT_URL=$PRISMA_GENERATE_DB_URL \
  npx prisma generate

# Compiled application.
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Drop privileges.
RUN useradd --system --uid 1001 --home /app appuser \
  && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000
ENV PORT=3000

# Liveness probe target for orchestrators that read the Dockerfile
# (Compose, some PaaS). Kubernetes/Render/Railway define their own.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
