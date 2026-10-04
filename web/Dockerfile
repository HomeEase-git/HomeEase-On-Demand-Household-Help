# syntax=docker/dockerfile:1
# Build context must be the REPO ROOT (the app imports ../shared):
#   docker build -f web/Dockerfile -t homeease-web .

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY shared ./shared
COPY web ./web
# Baked in at build time. Leave as "/api" to use the nginx same-origin proxy
# (see nginx.conf.template); set to an absolute URL for a CDN/standalone
# deploy that talks straight to the API.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN cd web && npm run build

# ---------- runtime ----------
# Current stable nginx line — rebuilt upstream with Alpine security fixes.
# 1.27 stopped getting rebuilds in 2025 and carried critical OpenSSL CVEs
# (found by the Trivy scan, security.yml). Dependabot proposes newer tags.
FROM nginx:1.31-alpine AS runtime
# Alpine security fixes released since the tag was last rebuilt.
RUN apk upgrade --no-cache
# Upstream for the /api proxy; overridden per environment.
ENV BACKEND_URL=http://backend:3000
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
