# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install ALL deps (incl. dev) — the build needs @nestjs/cli, typescript, prisma.
COPY apps/api/package*.json ./
RUN npm ci

COPY apps/api ./
# Generate the Prisma client (queryCompiler: pure JS, no engine binary) then compile.
RUN npm run prisma:generate && npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Non-root user for security
RUN addgroup -S routesync && adduser -S routesync -G routesync

# Production dependencies only, then bring in the compiled app and the generated
# Prisma client (which npm ci --omit=dev would not have created on its own).
COPY apps/api/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER routesync

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/main.js"]
