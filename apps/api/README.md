# RouteSync API (NestJS)

Business API: auth, users, subscriptions, routes, uploads, streaming, search,
admin, webhooks (deliverables #3, #5, #16).

## Run

```bash
# 0. start infra (from repo root): docker compose -f infra/docker-compose.yml up -d
#    then load schema + seed (see db/ and repo README)

cp .env.example .env         # DATABASE_URL points at localhost:5433
npm install
npm run prisma:generate      # generates the client (no native engine — see below)
npm run build && npm run start:prod   # → http://localhost:3000  (Swagger at /docs)
# or: npm run start:dev  (watch mode)
```

Log in with the seeded account: **`demo@routesync.uk` / `Password123!`**.

### No-native-engine Prisma (works behind the corporate proxy)

This project uses **Prisma 6 with `engineType = "client"` (queryCompiler) + the `pg`
driver adapter**, so there is **no native query-engine binary** — nothing is fetched
from `binaries.prisma.sh` at runtime. This is deliberate: that host is blocked by the
corporate TLS proxy here.

- The DB connection goes through `pg` (see [`src/database/prisma.service.ts`](src/database/prisma.service.ts)).
- Prisma enums are `@@map`-ed to the snake_case native enum types created by
  [`db/schema.sql`](../../db/schema.sql).
- `npm run prisma:generate` wraps `prisma generate` with env vars that skip the CLI's
  engine-download preflight ([`scripts/prisma-generate.mjs`](scripts/prisma-generate.mjs)).
  Plain `npx prisma generate` will fail behind the proxy — use the npm script.

### Outbound HTTPS behind the same proxy (email, R2)

The proxy re-signs HTTPS with the company's own root. Windows trusts it; Node reads its
own bundled roots instead, so calls to Resend or R2 fail with
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` — which in the API looks like signup working while no
verification email ever arrives, because [`MailService`](src/modules/mail/mail.service.ts)
returns transport failures as values rather than throwing.

`start:dev` and `start:prod` therefore go through
[`scripts/with-corp-ca.mjs`](scripts/with-corp-ca.mjs), which sets `NODE_EXTRA_CA_CERTS`
when `infra/local-ca/ca-bundle.pem` exists (the same git-ignored bundle
[`docker-compose.corp-ca.yml`](../../docker-compose.corp-ca.yml) mounts into the worker).
On a normal network there is no bundle and the command runs unchanged. **Starting the API
with a bare `node dist/main` skips this** and email will silently fail again.

## Modules (`src/modules/*`)

`auth` (JWT + Google/Apple OAuth, rotating refresh tokens) · `users` (profile +
GDPR export/erasure) · `subscriptions` (entitlements, Stripe/RevenueCat webhooks) ·
`routes` (list/detail/playback manifest/practice, premium-gated) · `uploads`
(presigned direct-to-R2 + pipeline enqueue + status) · `search` (PostGIS + FTS) ·
`storage` (S3/R2/MinIO signed URLs) · `queue` (Redis hand-off to Python worker) ·
`webhooks` · `admin` (review queue, moderation, analytics).

## Cross-cutting

Global `ValidationPipe` (whitelist + transform), `AllExceptionsFilter` (problem+json),
`ThrottlerGuard` (120 req/min/IP), `JwtAuthGuard` + `RolesGuard` + `EntitlementGuard`
(premium). Config is zod-validated at boot.
