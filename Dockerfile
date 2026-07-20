# ── RouteSync frontends (web + admin) ─────────────────────────────────────────
# Builds both Vite/React apps and serves their static bundles from a single
# non-root nginx image. Build from the repo root so the monorepo paths resolve:
#   docker build -t routesync-frontends .
#   docker run --rm -p 5174:5174 -p 5180:5180 routesync-frontends
#
# The API (apps/api) and worker (services/worker) have their own Dockerfiles.

# ── Stage 1: build the static bundles ─────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps first (with dev deps — vite/tsc are needed to build), copy
# manifests separately so the npm layers cache when only source changes.
COPY apps/web/package*.json ./web/
RUN cd web && npm ci
COPY apps/admin/package*.json ./admin/
RUN cd admin && npm ci

# Build web (port 5174) and admin (port 5180)
COPY apps/web ./web/
RUN cd web && npm run build
COPY apps/admin ./admin/
RUN cd admin && npm run build

# ── Stage 2: serve with a non-root nginx ──────────────────────────────────────
# nginx-unprivileged already runs as a non-root user and writes its pid/temp
# files to writable locations, so no extra hardening is needed.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

COPY infra/nginx/frontends.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/web/dist   /usr/share/nginx/html/web
COPY --from=builder /app/admin/dist /usr/share/nginx/html/admin

EXPOSE 5174 5180

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5174/ >/dev/null 2>&1 || exit 1

# Inherits nginx entrypoint/CMD from the base image (nginx -g "daemon off;")
