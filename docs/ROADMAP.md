# RouteSync — End-to-End Build Roadmap

Status legend: ✅ done & verified · 🟡 partial / stubbed · ⬜ not started

This roadmap maps every requirement from the brief to a concrete deliverable and
tracks progress. We work through it phase by phase.

---

## Phase 0 — Foundations & design  ✅ COMPLETE
- ✅ System architecture document (all 16 design deliverables) — `docs/ARCHITECTURE.md`
- ✅ Final tech stack chosen (free/local-friendly) with rented-vs-built decisions
- ✅ PostgreSQL + PostGIS schema, incl. gap-filling tables — `db/schema.sql`
- ✅ Monorepo layout (apps/api, apps/admin, apps/mobile, services/worker, infra)
- ✅ Local infra: docker-compose (Postgres+PostGIS, Redis, MinIO) — `infra/`
- ✅ CI/CD workflow, .gitignore, env templates, per-package READMEs

## Phase 1 — Backend core (NestJS API)  ✅ MOSTLY COMPLETE
- ✅ Config (zod-validated), Prisma module, global filters/pipes/guards, throttling
- ✅ Auth: register/login, JWT access + rotating refresh, RBAC
- ✅ Google OAuth (id_token verify)
- 🟡 Apple Sign-in (JWKS signature verification still stubbed)
- ✅ Users: profile, GDPR export/erasure endpoints
- 🟡 GDPR export/erasure async jobs (endpoints record request; purge job is TODO)
- ✅ Subscriptions: plans, entitlements, `EntitlementGuard` (server-side premium gate)
- ✅ Health check, Swagger docs

## Phase 2 — Upload → playback slice  ✅ COMPLETE (verified, FFmpeg-less fallback)
- ✅ Upload init (presigned direct-to-storage) + route draft creation + linking
- ✅ Upload complete (object verification) + pipeline enqueue (Redis hand-off)
- ✅ Upload status (per-stage findings)
- ✅ Worker pipeline orchestrator (17 stages, idempotent, flag-on-failure)
- ✅ FFmpeg ops: probe, lossless + normalising concat, re-encode, HLS, thumbnail
- ✅ Media path: download → merge → HLS → thumbnail → upload renditions
- ✅ Gap/overlap detection + front/rear reconciliation
- ✅ GPS validation (drift/teleport/signal-loss/speed-anomaly → score) — verified
- ✅ Quality score (weighted 0–100) — verified
- ✅ Duplicate fingerprint (GPX geometry hash + distance bucket) — verified
- ✅ Routes: list, detail, signed multi-view playback manifest (premium-gated)
- 🟡 Sync engine (timestamp align + correlation fn done; motion extraction from real
      video frames not yet wired)
- 🟡 Adaptive streaming (single HLS rendition; full bitrate ladder TODO)
- ⬜ Run a real end-to-end merge (needs FFmpeg binary + sample clips)

## Phase 3 — Practice mode & maps  ✅ CORE COMPLETE (verified)
- ✅ Valhalla integration (`trace_route` map-matching) — optional docker service + worker client
- ✅ GPX → turn-by-turn instructions generator (`worker/navigation.py`) with
      geometry fallback when no routing engine is configured — verified on synthetic route
- ✅ Junction/roundabout marker extraction (populates `route_markers`)
- ✅ UK-English phrasing (turns, bear/sharp, U-turn, roundabout exit ordinals)
- ✅ Wired into pipeline: populates `route_instructions`, `route_markers`,
      `routes.junction_count` / `roundabout_count`
- ✅ Practice API returns instructions + summary + `en-GB` voice contract
- ✅ Playback API returns timeline markers for the scrubber
- 🟡 Speed-limit enrichment (only via Valhalla; geometry fallback leaves it null)
- 🟡 Roundabout exit accuracy (exact via Valhalla; geometry estimate is approximate)
- ⬜ UK-English voice playback is a client-side TTS concern (Flutter, Phase 10)

## Phase 4 — AI privacy & advanced sync  🟡 SCAFFOLDED
- 🟡 Face + number-plate blur (YOLO + OpenCV) — code present, gated off, untested
- ⬜ Train/select plate + face models; validate blur coverage
- ⬜ Whisper transcription (captions / accessibility)
- ⬜ Sync fine-alignment from real optical-flow motion energy
- ⬜ Video validation on real merged file (black/frozen/corruption in pipeline)

## Phase 5 — Search & discovery  ✅ CORE DONE
- ✅ Route search (test centre / town / postcode / difficulty / contributor / instructor)
- ✅ Full-text search + instructor search boost
- ✅ Nearest test centres (PostGIS KNN)
- ⬜ Test-centre seed data (UK DVSA centres) for cold-start
- ⬜ Seed routes for major test centres (cold-start content)
- ⬜ Graduate to OpenSearch at scale

## Phase 6 — Community & contributor system  ✅ COMPLETE
- ✅ Contributor profiles (`GET /contributors/:id`, `/contributors/me/profile`)
- ✅ Reputation calculation (publish volume + avg quality + instructor bonus), recomputed on publish
- ✅ Credits accrual on publish (+ high-quality bonus)
- ✅ Badges rules engine + award (first/ten/fifty routes, high-quality, instructor);
      catalogue seeded idempotently at boot
- ✅ Leaderboards (`GET /leaderboards?period=`) materialised nightly via `@Cron` (all-time + monthly)
- ✅ Contributor footage-licensing agreement gate enforced on upload init
      (`POST /contributors/agreement`)
- ✅ Instructor verification workflow end-to-end: contributor submits ADI evidence
      (`POST /instructors/verify`) → admin verifies (Phase 9) → role + badge + reputation boost
- 🟡 Credits currently informational; no spend/redemption mechanic yet

## Phase 7 — Payments  ✅ CORE COMPLETE
- ✅ Plan definitions + entitlement model
- ✅ Stripe Checkout session creation (real; `StripeService`, plan→price mapping)
- ✅ Stripe webhook: raw-body signature verification + event→entitlement mapping
      (checkout.completed, subscription.created/updated/deleted, invoice.payment_failed)
- ✅ RevenueCat webhook: shared-secret auth + IAP event mapping
      (INITIAL_PURCHASE/RENEWAL/PRODUCT_CHANGE/CANCELLATION/EXPIRATION/BILLING_ISSUE)
- ✅ Subscription lifecycle: past_due grace (payment_failed), cancellation → free,
      every event persisted to `subscription_events` for reconciliation
- ✅ Usage quota / cost-control: per-tier monthly upload cap enforced on upload init
      (premium = unlimited), tracked in `usage_quotas`
- 🟡 Refund handling (Stripe refunds logged via events; no automated entitlement change)
- ⬜ Live keys + real end-to-end purchase test (needs Stripe/RevenueCat accounts)

## Phase 8 — Instructor Community Fund  ✅ COMPLETE
- ✅ Explicit "net profit" formula (gross from active subs − assumed cost ratio) with
      the assumption stored on every entry — `fund.constants.ts`
- ✅ Automated monthly 10%-of-net-profit contribution via `@Cron` (idempotent per period)
- ✅ Fund ledger entries (contribution / allocation / payout) with balance tracking
- ✅ Beneficiaries management (create, list) + payouts (balance-checked)
- ✅ Public transparency endpoints: `GET /fund/summary`, `GET /fund/reports?year=`
- ✅ Admin fund panel: balance, run-contribution, beneficiaries, payouts, transactions
- 🟡 Real net profit uses actual paid invoices (currently MRR-based estimate until
      live payment data flows)

## Phase 9 — Admin dashboard (React)  ✅ COMPLETE (builds clean)
- ✅ Login + auth token handling
- ✅ Sidebar layout + view routing + pending-review badge
- ✅ Review queue (table) + per-route detail drawer
- ✅ Per-route detail: pipeline-stage findings + quality breakdown + signed thumbnail
      preview + approve/reject
- ✅ User management (search, role change, suspend/reinstate) — admin-gated mutations
- ✅ Instructor verification panel (verify/reject → role + contributor status update)
- ✅ Revenue panel (MRR estimate, plan/status breakdown)
- ✅ Fund management panel (ledger totals, allocation form, transactions)
- ✅ Reports panel (open user reports)
- 🟡 Backend endpoints use raw SQL for unmapped tables; revenue is local-data estimate
      until Stripe/RevenueCat webhooks land (Phase 7)
- ⬜ GDPR actions from user panel (export/erase trigger) — endpoints exist under /users

## Phase 10 — Flutter mobile app  🟡 CORE BUILT (lib/ complete; unverified — no SDK here)
- ✅ Project config, theming (mobile-first, accessible M3), `go_router`, Dio API client
      with bearer + auto token-refresh, secure token store
- ✅ Auth: email login/register; Google/Apple buttons (token exchange TODO)
- ✅ Home / discover (route list + pull-to-refresh)
- ✅ Search UI (query + difficulty filter)
- ✅ Route detail (preview + Watch/Practice, entitlement pre-check → paywall)
- ✅ Route player: `MasterTimelineController` (front/rear on one clock, offset-aware
      resync), Front/Rear/Split/Map views, scrubber, HUD, slow-motion
- ✅ Practice mode (timeline clock + UK-English `flutter_tts`, no video, checklist)
- ✅ Subscription paywall (plan cards; RevenueCat purchase flow TODO)
- ✅ Contribute: instructor-verification form (live API); upload flow placeholder
- ✅ Unit tests for model parsing
- 🟡 Playback Map view needs track-geometry (lat/lon) from the API to draw the route
- ⬜ Social sign-in token exchange + RevenueCat purchase wiring
- ⬜ Resumable multi-clip upload (file_picker → presigned PUT → status polling)
- ⬜ Offline mode (download manager, encrypted packages, map tiles)
- ⬜ Community screens (profile, badges, leaderboards)
- ⬜ `flutter analyze` / device run (needs Flutter SDK; not available in this env)

## Phase 11 — Cross-cutting: notifications, offline, accessibility  ⬜
- ⬜ Notifications module (push FCM/APNs + email, BullMQ-driven)
- ⬜ Device token registration
- ⬜ Offline package builder (video + GPX + voice + map tiles, encrypted)
- ⬜ Accessibility pass (captions, screen-reader labels, contrast)
- ⬜ Content moderation/abuse: user reports → moderation actions
- ⬜ Takedown request handling (privacy)

## Phase 12 — Hardening & production  🟡 PARTIAL
- 🟡 CI/CD pipeline file exists; needs deploy stages wired
- ⬜ Dockerfiles (api, worker) + image builds
- ⬜ Observability: Sentry + OpenTelemetry instrumentation (config present, not wired)
- ⬜ Security review: signed-URL scoping, AV scan on upload, secrets manager
- ⬜ Load/perf: read replicas, PgBouncer, table partitioning, cache strategy
- ⬜ Resumable/multipart uploads for large clips
- ⬜ Test suites: API e2e, worker unit/integration, mobile widget tests
- ⬜ Deployment architecture (Fly.io/ECS → k8s), autoscaling worker pool

---

## Progress snapshot

| Phase | Status |
|---|---|
| 0 Foundations & design | ✅ 100% |
| 1 Backend core | ✅ ~85% (Apple login, GDPR jobs pending) |
| 2 Upload→playback slice | ✅ ~90% (real merge run + bitrate ladder pending) |
| 3 Practice mode & maps | ✅ ~85% (core done; speed-limit + exact roundabout exits via Valhalla) |
| 4 AI privacy & sync | 🟡 ~20% (scaffolded, gated off) |
| 5 Search & discovery | ✅ ~70% (seed data pending) |
| 6 Community & contributor | ✅ ~90% (profiles, credits, badges, leaderboards, agreement, instructor flow) |
| 7 Payments | ✅ ~85% (Stripe + RevenueCat wired, quotas enforced; live test pending) |
| 8 Instructor fund | ✅ ~90% (formula, monthly cron, ledger, payouts, public report) |
| 9 Admin dashboard | ✅ ~90% (all panels live; GDPR triggers + live revenue pending) |
| 10 Flutter mobile app | 🟡 ~55% (core lib/ built: auth, discovery, player, practice, paywall; upload/offline/social/IAP wiring + SDK verification pending) |
| 11 Notifications/offline/a11y | ⬜ 0% |
| 12 Hardening & production | 🟡 ~10% (CI skeleton) |

**Overall: design 100%, backend foundation strong, product surface ~30% built.**
The hardest backend risk (the media pipeline) is wired and unit-verified; the
largest remaining effort is the Flutter app (Phase 10) and the community/fund/
payments business logic (Phases 6–8).
