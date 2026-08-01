# Test Routify — System Architecture

> A UK driving-route learning platform. Watch real, GPS-synchronised driving routes
> (front + rear dashcam), then practise them later as turn-by-turn voice navigation.

This document is **deliverable #1–#15**. The PostgreSQL schema (#4) lives in
[`db/schema.sql`](../db/schema.sql). Example code for critical modules (#16) is the
running code under [`apps/`](../apps/) and [`services/`](../services/).

---

## 0. Guiding principles

1. **Don't build undifferentiated heavy lifting for v1.** Rent transcoding, payments,
   and OAuth where renting is free/cheap and self-hosting is weeks of risk.
2. **Separate the two hard problems.** The *business API* (Node/Nest) and the *media+AI
   pipeline* (Python) are different beasts in different languages, joined only by a queue
   and object storage.
3. **The supply side is the product.** Without a steady flow of good recordings the app
   is empty, so the upload→process→publish pipeline and contributor experience get
   first-class treatment.
4. **Start cheap, scale on evidence.** Everything below runs on a laptop via
   `docker-compose`, and every rented service has a free local stand-in (MinIO for R2,
   self-hosted FFmpeg HLS for Cloudflare Stream, OSRM/Valhalla for maps).

---

## 1. Final tech stack (chosen for free + easy + scalable)

| Concern | Choice | Why this one | Free/local dev stand-in |
|---|---|---|---|
| Mobile app | **Flutter** (iOS + Android) | One codebase, native video + maps plugins | n/a |
| Web app + admin console | **React + Vite + TypeScript** | One SPA; the admin console is lazy-loaded at `/admin` (admin/moderator only) | n/a |
| Business API | **NestJS (TypeScript)** | Structured, modular, great DTO/validation/auth story | n/a |
| Media + AI workers | **Python** (FastAPI control + RQ workers) | FFmpeg, OpenCV, YOLO, Whisper are Python-native | runs locally |
| Database | **PostgreSQL 16 + PostGIS** | Spatial types/indexes for routes, fingerprints, test-centre search | docker |
| Cache / queues | **Redis + BullMQ** (app jobs) + **RQ** (media jobs) | One Redis, two queue libs for two languages | docker |
| Object storage | **Cloudflare R2** (S3 API, **zero egress fees**) | Cheapest for a video app at scale | **MinIO** (docker) |
| Video transcode + secure delivery | **Cloudflare Stream** (or AWS MediaConvert) | HLS/DASH, signed playback, no DRM plumbing to build | local FFmpeg → HLS |
| CDN | **Cloudflare CDN** | Bundled with R2/Stream, generous free tier | direct serve |
| Maps + routing | **OpenStreetMap tiles + Valhalla** (self-host) / GraphHopper | Offline-legal tiles, free routing, turn instructions | OSRM demo server |
| Payments (web) | **Stripe** | Handles UK VAT, dunning, refunds | Stripe test mode |
| Payments (mobile) | **Apple/Google IAP** via RevenueCat | App-store policy compliance (see §10) | sandbox |
| Auth | **JWT + Passport** (Google, Apple, email) self-hosted | Free, full control; OAuth providers are free | local |
| Search | **Postgres FTS + PostGIS** v1 → **OpenSearch** later | No extra infra to start | postgres |
| Observability | **Sentry** (errors) + **OpenTelemetry → Grafana/Tempo/Loki** | Free tiers; OTEL is vendor-neutral | docker |
| Container / deploy | **Docker** → **ECS/Fly.io** v1 → **Kubernetes** at scale | Don't start on k8s with 0 users | docker-compose |

**Resolved conflicts from the brief:** BullMQ *and* Python both exist — BullMQ for app
jobs (emails, notifications, billing webhooks), Python/RQ for media jobs. Google Maps is
**dropped** in favour of OSM+Valhalla because Google tiles can't be cached for offline
mode and per-request pricing is hostile at video scale.

---

## 2. High-level system architecture

```
                                 ┌──────────────────────────────┐
   Flutter app  ───────────────► │        Cloudflare CDN        │ ◄─── HLS playback
   (iOS/Android)                 │   (Stream + R2 + tile cache) │      (signed URLs)
        │                        └──────────────────────────────┘
        │ HTTPS/JWT                              ▲
        ▼                                        │ signed URLs / webhooks
┌───────────────────┐   REST/JSON   ┌────────────────────────────┐
│   API Gateway     │ ◄───────────► │      NestJS Business API   │
│ (Nginx / Cloud LB)│               │  auth · users · subs ·     │
└───────────────────┘               │  routes · uploads · search │
        ▲                           │  community · admin · fund  │
        │                           └───────────┬────────────────┘
   React web app (+ /admin)                     │
                                   ┌─────────────┼───────────────┐
                                   ▼             ▼               ▼
                            ┌──────────┐  ┌────────────┐  ┌──────────────┐
                            │ Postgres │  │   Redis    │  │ Object store │
                            │ +PostGIS │  │ BullMQ+RQ  │  │  R2 / MinIO  │
                            └──────────┘  └─────┬──────┘  └──────┬───────┘
                                                │ media jobs     │ read/write
                                                ▼                ▼
                                   ┌────────────────────────────────────────┐
                                   │     Python Media + AI Worker Pool       │
                                   │  ingest → probe → gap/overlap detect →  │
                                   │  merge (FFmpeg) → sync engine → GPS/    │
                                   │  video validation → AI blur (YOLO/CV) → │
                                   │  Whisper · transcode/HLS · previews     │
                                   └────────────────────────────────────────┘
```

**Why this shape:** the API never blocks on media work — it enqueues a job and returns.
Workers scale horizontally and independently of the API. Clients fetch media bytes straight
from object storage, never through the API origin.

Route footage is paid content, so it is not served from a public CDN origin: the player
asks the API's signed HLS gateway (`GET /api/routes/:id/hls/:token/:view/:file`), which
authorises the request against a playback token and redirects to a short-lived presigned
URL. The bytes still travel storage → client. Thumbnails are the one asset class that may
be public (`CDN_PUBLIC_ASSETS=thumbnail`), because they already appear on unpaid pages.

---

## 3. NestJS backend folder structure (deliverable #3)

```
apps/api/src/
├── main.ts
├── app.module.ts
├── common/            # guards, interceptors, filters, pipes, decorators
├── config/            # typed config (zod-validated env)
├── database/          # Prisma client module
├── modules/
│   ├── auth/          # JWT, refresh tokens, Google/Apple OAuth, RBAC
│   ├── users/         # profile, roles, GDPR delete/export
│   ├── subscriptions/ # Stripe + IAP (RevenueCat) reconciliation, entitlements
│   ├── routes/        # CRUD, publish lifecycle, quality score read
│   ├── uploads/       # multipart/resumable init, enqueue media jobs, status
│   ├── streaming/     # signed playback URL issuance, download protection
│   ├── search/        # test centre / town / postcode / difficulty / contributor
│   ├── community/     # contributors, badges, leaderboards, reputation
│   ├── instructors/   # ADI verification workflow
│   ├── fund/          # Instructor Community Fund ledger + reports
│   ├── admin/         # moderation, user mgmt, analytics, review queue
│   ├── notifications/ # push (FCM/APNs) + email, BullMQ-backed
│   └── webhooks/      # Stripe, RevenueCat, worker callbacks
└── jobs/              # BullMQ producers/consumers (email, notify, billing)
```

Each module = `*.module.ts` + `*.controller.ts` + `*.service.ts` + `dto/` + `entities/`.
Cross-cutting: global `JwtAuthGuard`, `RolesGuard`, `EntitlementGuard` (premium gate),
`ValidationPipe`, `AllExceptionsFilter`, request-id + OTEL interceptor.

---

## 4. Flutter app structure (deliverable for mobile)

```
apps/mobile/lib/
├── main.dart
├── core/            # env, dio client, interceptors, result types, router
├── theme/           # mobile-first, accessible (contrast, text scale)
├── data/            # api clients, dto, local db (drift/isar), repositories
├── features/
│   ├── auth/        # google/apple/email sign-in
│   ├── home/        # discover routes near my test centre
│   ├── search/      # test centre / town / postcode filters
│   ├── route_player/# master timeline controller (see §9)
│   ├── practice/    # GPX → instructions → UK TTS voice
│   ├── offline/     # download manager, package storage, map tiles
│   ├── upload/      # multi-clip + GPX resumable upload, progress, status
│   ├── community/   # profile, badges, leaderboards
│   └── subscription/# paywall, RevenueCat IAP
└── shared/          # widgets, player engine, sync clock
```

The master timeline controller and offline packager are the two pieces of genuine mobile
engineering; everything else is standard feature UI.

---

## 5. API documentation (deliverable #5)

Full OpenAPI is auto-generated by Nest Swagger at `/docs`. Representative surface:

```
Auth
  POST   /auth/register                 email+password
  POST   /auth/login                    → {access, refresh}
  POST   /auth/refresh
  POST   /auth/oauth/google             id_token → session
  POST   /auth/oauth/apple              identity_token → session
  POST   /auth/logout

Users
  GET    /users/me
  PATCH  /users/me
  POST   /users/me/export               GDPR data export (async)
  DELETE /users/me                      GDPR erasure (async, audited)

Subscriptions
  GET    /subscriptions/plans
  GET    /subscriptions/me              entitlements
  POST   /subscriptions/checkout        Stripe Checkout (web)
  POST   /webhooks/stripe               (internal)
  POST   /webhooks/revenuecat           (internal, mobile IAP)

Routes
  GET    /routes                        paginated, filterable
  GET    /routes/:id                    detail + preview + quality
  GET    /routes/:id/playback           signed multi-view manifest (premium-gated)
  GET    /routes/:id/practice           GPX-derived instruction set
  POST   /routes                        create draft (contributor)

Uploads
  POST   /uploads                       init upload session (front/rear/gpx)
  PUT    /uploads/:id/parts/:n          resumable part (or presigned direct-to-R2)
  POST   /uploads/:id/complete          enqueue media pipeline
  GET    /uploads/:id                   pipeline status + per-stage detail

Search
  GET    /search/routes?testCentre=&town=&postcode=&difficulty=&contributor=&instructor=
  GET    /search/test-centres?near=lat,lng

Community
  GET    /contributors/:id              profile, reputation, badges
  GET    /leaderboards?period=
  GET    /badges

Instructors
  POST   /instructors/verify            submit ADI evidence
  GET    /instructors/me/status

Fund
  GET    /fund/summary                  public transparency report
  GET    /fund/reports?year=

Admin   (RBAC: admin/moderator)
  GET    /admin/review-queue
  POST   /admin/routes/:id/moderate     approve/reject + reason
  POST   /admin/instructors/:id/verify
  GET    /admin/analytics
  GET    /admin/revenue
  POST   /admin/fund/allocate
```

Conventions: cursor pagination, RFC-7807 problem+json errors, idempotency keys on
mutations, per-user + per-IP rate limits, `If-None-Match`/ETag on reads.

---

## 6. Sync engine architecture (deliverable #6)

The hardest correctness problem: front cam, rear cam, and GPS logger each have an
independent clock.

```
Inputs: merged_front.mp4, merged_rear.mp4, track.gpx (+ per-clip start timestamps)

1. Establish a master clock from the most trustworthy source:
     GPS time (UTC, satellite-disciplined) > camera embedded GPS > file mtime.
2. Coarse align: map each video's clip-start timestamps onto the GPS timeline.
3. Fine align (motion correlation):
     - derive a "motion energy" signal from video (optical-flow magnitude / frame diff)
     - derive a speed signal from GPX (Δdistance / Δtime)
     - cross-correlate → best lag → sub-second offset per stream
4. Reconcile front vs rear: pick later start / earlier end as common window;
     compute drift (front_offset − rear_offset); flag if |drift| > threshold.
5. Auto-trim excess footage outside the GPS window; auto-pad gaps with freeze/black
     + a "no footage" overlay rather than desyncing.
6. Sync confidence = f(correlation peak sharpness, GPS quality, gap count, drift).
7. Persist offsets + confidence; expose a manual nudge (±ms) in admin/upload UI.
```

Output is a **sync manifest** (per-stream offset, trims, pad regions, confidence) the
player consumes so all four views + telemetry share one timeline.

---

## 7. Upload pipeline architecture (deliverable #7)

```
client                NestJS                 R2/MinIO            Redis(RQ)        Python workers
  │ init upload  ───────►│ create upload row  │                    │                  │
  │ ◄ presigned PUTs ────│                    │                    │                  │
  │ direct PUT parts ─────────────────────────►│                    │                  │
  │ complete    ────────►│ verify objects ────►│                    │                  │
  │              ────────►│ enqueue pipeline ──────────────────────►│ pop job ────────►│
  │ poll status ────────►│ read upload.stages │                    │                  │
                          │ ◄── stage callbacks (webhook) ──────────────────────────────│
```

**Pipeline stages** (each idempotent, retryable, writes progress to `uploads.stages`):

```
INGEST → PROBE(ffprobe) → CLIP_SORT(by timestamp) → CONTINUITY/GAP_DETECT →
OVERLAP_DETECT → MERGE(ffmpeg concat) → REENCODE(H264/H265) →
FRONT_REAR_RECONCILE → SYNC_ENGINE(§6) → GPS_VALIDATE → VIDEO_VALIDATE →
AI_PRIVACY_BLUR(faces+plates) → TRANSCODE_HLS/DASH → PREVIEW_GEN →
DUPLICATE_CHECK(fingerprint) → QUALITY_SCORE → READY_FOR_REVIEW
```

Any stage can set status `flagged` (needs human) without failing the whole job.

---

## 8. FFmpeg merge workflow (deliverable #8)

```
1. ffprobe each clip → codec, resolution, fps, duration, start_time, rotation.
2. Sort clips per camera by embedded creation time; detect gaps/overlaps vs expected.
3. Normalise: if codecs/params differ, re-encode to a common intermediate
     (yuv420p, CFR fps, consistent SAR) so concat is seamless.
4. Concat:
     - same params  → ffmpeg concat demuxer (stream copy, fast, lossless)
     - mixed params → concat filter with prior normalisation
5. Re-encode delivery master:
     H.264 main profile (libx264) only. H.265 would be ~35% smaller, but hls.js cannot
     decode it through Media Source Extensions on Chrome or Firefox, so it plays on
     Safari and nowhere else. The worker overrides any other configured codec.
6. Adaptive streaming: ffmpeg → HLS variant ladder (1080/720/480/360) + master.m3u8,
     or hand the merged master to Cloudflare Stream and let it build the ladder.
7. Generate poster/thumbnail (-ss seek + scale) and a sprite sheet for scrubbing.
```

Gap handling: when a clip is missing, insert a generated black/“footage missing” segment
of the gap’s duration so the merged video stays time-true to the GPS track.

---

## 9. Route playback engine (deliverable #9)

A **master timeline controller** owns a single `position` (ms). Everything subscribes:

```
MasterClock(position)
  ├─ FrontVideoController   seekTo(position + frontOffset)
  ├─ RearVideoController    seekTo(position + rearOffset)
  ├─ MapController          camera → gpx.interpolate(position)
  ├─ TelemetryHUD           speed/distance from gpx.interpolate(position)
  └─ MarkersLayer           junctions/roundabouts at their timestamps
```

- Scrubbing sets `position`; controller fans out seeks; uses the slower stream as the
  pacing reference and resyncs every N frames to bound drift.
- View modes (Front / Rear / Split / Map) only change *rendering*, never the clock.
- Slow-motion = scale playbackRate on all controllers together.
- Practice mode reuses the GPX interpolation + markers, **drops all video controllers**,
  and feeds an instruction queue to UK-English TTS.

---

## 10. Subscription system (deliverable #10)

- **Access model:** Registration is required for **all** access, including the demo — there is no
  anonymous entry. Learners then **browse freely**: test centres are a first-class, browsable
  section (the default landing page after sign-in) and every route belongs to exactly one centre.
  There is **no** mandatory test-centre/test-date gate (removed in Phase 20). Access resolves as:
  (a) Premium for a route's test centre unlocks **all** routes at that centre; (b) otherwise the
  **first route the user opens** becomes their one free demo route (account-wide, any centre);
  (c) any further route → the per-centre paywall.
- **Plans:** Demo/Free (**one route total, account-wide**), Premium £4.99/mo or £39.99/yr
  **per test centre**.
- **Premium is purchased per test centre and is not switchable** — model each subscription as a
  `(user, test_centre)` entitlement unlocking unlimited routes for that one centre; covering
  multiple centres means multiple concurrent subscriptions.
- **Premium unlocks (for the purchased centre):** unlimited routes, practice mode, multi-view,
  offline, instructor routes — enforced server-side by an `EntitlementGuard` keyed on the route's
  test centre, never trusted from the client.
- **Web** → Stripe Checkout + Customer Portal (handles UK VAT, dunning, refunds).
- **Mobile** → **Apple/Google IAP via RevenueCat** (this is mandatory — Apple/Google
  require digital subscriptions to go through IAP; selling Stripe inside the app gets the
  app rejected). RevenueCat normalises both stores + Stripe into one entitlement.
- Source of truth = `subscriptions` table (now carrying `test_centre_id`), updated by
  **webhooks** (Stripe + RevenueCat), reconciled nightly. Entitlement cached in Redis with short TTL.
- **Access-control tables:**
  - `demo_route_claims` — a non-Premium user's single claimed route (PK on `user_id` → one per
    account, account-wide/any centre); claimed on first watch/practise of the first route opened.
- **Central decision point:** `RoutesService.resolveAccess()` folds the two checks — per-centre
  Premium → one-route demo allowance — into one result (the Phase 19 test-details gate was removed
  in Phase 20). `GET /routes/:id/access` exposes it as a dry run (no claim side-effect) so web +
  mobile route to the right next step; `playback`/`practice` enforce it and claim the demo route on
  first use.

---

## 11. Contributor system (deliverable #11)

- Contributors upload routes; on publish they earn **credits** and **reputation**.
- **Reputation** = f(approved routes, avg quality score, community votes, penalties).
- **Badges** awarded by rules engine (first route, 10 routes, high-quality streak…).
- **Leaderboards** materialised per period (weekly/monthly/all-time) via a scheduled job.
- **Verified instructors** (ADI): submit DVSA ADI number + evidence → manual admin
  verification → `instructor` badge, **search boost**, and **fast-track approval** queue.

---

## 12. Admin dashboard (deliverable #12)

Part of the web app (`apps/web`) — the admin console is lazy-loaded at `/admin` and
gated to admin/moderator roles (server-side authz is still enforced on `/api/admin/*`
by the API's `RolesGuard`). Panels: **Review queue** (pipeline output, blur preview,
quality/sync scores, approve/reject with reason) · **Route moderation** · **User mgmt**
(roles, suspensions, GDPR actions) · **Instructor verification** · **Analytics**
(DAU, conversion, route watch funnels) · **Revenue** (Stripe/IAP) · **Fund management**
(allocations, beneficiaries, reports).

---

## 13. CI/CD pipeline (deliverable #13)

```
GitHub Actions
  lint+typecheck  → unit tests → build images → push to registry
  ↳ api (Nest)    : jest, eslint, prisma migrate diff
  ↳ worker (py)   : pytest, ruff, mypy
  ↳ web (react)   : vitest, eslint, build (incl. lazy-loaded /admin console)
  ↳ mobile        : flutter analyze, flutter test, build apk/ipa (matrix)
  deploy: staging on main → smoke tests → manual gate → production
  db: migrations run as a pre-deploy job (forward-only, reversible)
```

Workflow file: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

---

## 14. Security architecture (deliverable #14)

- **AuthN:** short-lived JWT access (15m) + rotating refresh tokens (httpOnly, hashed at
  rest, revocable). OAuth id_token verified server-side (Apple/Google JWKS).
- **AuthZ:** RBAC (`user`/`contributor`/`instructor`/`moderator`/`admin`) + premium
  `EntitlementGuard`. All premium/admin checks server-side.
- **Media protection:** streaming only via **short-lived signed URLs**; no public bucket;
  download protection via signed, expiring, IP/UA-scoped tokens; offline packages
  encrypted at rest on device.
- **Input:** zod/class-validator on every DTO; file-type sniffing on uploads; size caps;
  AV scan hook.
- **Transport/secrets:** TLS everywhere, HSTS; secrets in a manager (not env files in
  prod); least-privilege bucket/DB creds.
- **Abuse:** rate limiting, idempotency keys, audit log on all admin + money + GDPR
  actions, CSRF protection for cookie flows.
- **Privacy/GDPR:** see §16.

---

## 15. Scalable production deployment (deliverable #15, → 1M users)

```
Cloudflare (CDN + Stream + R2 + WAF + tile cache)
        │
   Load balancer ──► NestJS API (stateless, autoscaled, N replicas)
        │                 │
        │            Postgres primary + read replicas (PgBouncer pool)
        │            Redis (managed, HA) — cache + BullMQ
        │
   Python worker pool (autoscaled by RQ queue depth; GPU nodes for YOLO/Whisper)
        │
   Object storage R2 (multi-region) · OpenSearch (search at scale)
   Observability: OTEL → Tempo/Loki/Grafana, Sentry, uptime checks
```

Scaling levers: stateless API horizontal scale; read replicas + PgBouncer for DB;
partition hot tables (`route_statistics`, audit) by time; CDN absorbs ~all media reads;
worker pool scales on queue depth with GPU nodes only for AI stages; cache entitlements
+ route metadata in Redis. **Start on Fly.io/ECS with docker-compose parity; graduate to
k8s when worker fleet management demands it.**

---

## 16. Gap-closing decisions (the gaps from analysis, now designed in)

| Gap raised earlier | Decision baked into this design |
|---|---|
| **App-store IAP vs Stripe** | RevenueCat + IAP on mobile, Stripe on web (§10) |
| **GDPR / public-road footage** | `data_subjects`, `takedown_requests`, `consent_records`, `audit_log` tables; async export + erasure endpoints; AI blur is mitigation not shield; retention policy fields |
| **Footage rights / licensing** | `contributor_agreements` table; upload blocked until accepted |
| **No recorder / capture protocol** | Documented capture protocol (clap-sync + GPS-disciplined timestamps); `uploads` stores per-clip clock source; sync engine §6 tolerates clock skew |
| **Capture clock skew** | Motion-correlation fine alignment in sync engine (§6) |
| **Content moderation/abuse** | Review queue + `moderation_actions`, `reports` (user-reported content) |
| **Notifications** | `notifications` module + table (push + email), BullMQ-driven |
| **Accessibility** | Mobile theme: text scaling, contrast, screen-reader labels; captions field on routes |
| **Observability** | Sentry + OTEL wired in API and workers from day one |
| **Cost controls** | `usage_quotas` + per-tier upload/processing caps; AI stages batched; egress via R2 (no egress fee) |
| **Refunds/dunning/failed payments** | Delegated to Stripe + RevenueCat; mirrored in `subscription_events` |
| **Fund transparency/accounting** | `fund_transactions` ledger (double-entry style), `fund_allocations`, `fund_beneficiaries`, public report endpoint with defined "net profit" formula |
| **Cold-start / empty app** | Seed routes for major UK test centres flagged via `routes.is_seed`; sample free route flag |

---

## Repository layout

```
routing-app/
├── docs/ARCHITECTURE.md          ← this file
├── db/schema.sql                 ← PostgreSQL + PostGIS schema (#4)
├── apps/
│   ├── api/                      ← NestJS business API (#3, #16)
│   ├── web/                      ← React web app; includes admin console at /admin (#12)
│   └── mobile/                   ← Flutter app
├── services/
│   └── worker/                   ← Python media + AI pipeline (#6,#7,#8,#16)
├── infra/
│   └── docker-compose.yml        ← postgres+postgis, redis, minio, api, worker
└── .github/workflows/ci.yml      ← CI/CD (#13)
```
