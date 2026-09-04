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

# ---------- build ----------
FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# generate the Prisma client (so tsc sees its types), then compile TS ->
# dist/ and rewrite the @/* path aliases (tsc-alias) so dist/ can run under
# plain node.
RUN npx prisma generate && npm run build

# ---------- runtime ----------
FROM base AS runtime
# Production dependencies only. `prisma` is a runtime dep here because the
# entrypoint runs `prisma migrate deploy`.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Prisma schema + config are needed both to (re)generate the client for
# this image's exact engine and to run migrations at start.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

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
