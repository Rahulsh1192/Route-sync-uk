# RouteSync — End-to-End Build Roadmap

**Last updated:** 2026-07-16  
**Version:** 2.0 — updated to reflect the full product spec including ADI booking,
in-app GPS recording, video-less routes, learner progress tracking, AI summaries,
offline packages, and single-session security.

Status legend: ✅ done & verified · 🟡 partial / stubbed · ⬜ not started

---

## Product Overview (v2)

RouteSync is a premium AI-powered learning platform for UK learner drivers and
Approved Driving Instructors (ADIs). It combines:

- **Route learning** — GPS-synchronised front + rear dashcam video for real test routes
- **Practice mode** — turn-by-turn UK-English voice guidance, no video (like the real test)
- **ADI booking** — learners book verified instructors directly through the app
- **AI insights** — learning summaries, progress tracking, personalised focus areas
- **Offline access** — encrypted route packages downloadable for use without internet
- **Contributor tools** — ADIs record or upload routes, earning reputation and credits

---

## User Roles

| Role | Description |
|---|---|
| `user` | Learner driver — browses, watches, practises, books instructors |
| `instructor` | Verified ADI — uploads routes, manages bookings, earns from platform |
| `contributor` | Non-ADI route contributor — uploads routes, earns credits |
| `moderator` | Platform staff — reviews uploads, handles reports |
| `admin` | Full platform access — all admin console features |

---

---

## Phase 0 — Foundations & design  ✅ COMPLETE
- ✅ System architecture document (all 16 design deliverables) — `docs/ARCHITECTURE.md`
- ✅ Final tech stack chosen (free/local-friendly) with rented-vs-built decisions
- ✅ PostgreSQL + PostGIS schema, incl. gap-filling tables — `db/schema.sql`
- ✅ Monorepo layout (apps/api, apps/admin, apps/mobile, services/worker, infra)
- ✅ Local infra: docker-compose (Postgres+PostGIS, Redis, MinIO) — `infra/`
- ✅ CI/CD workflow, .gitignore, env templates, per-package READMEs
- ✅ Sales deck (MD + PDF) — `docs/RouteSync-Sales-Deck.md`

---

## Phase 1 — Backend core (NestJS API)  ✅ MOSTLY COMPLETE
- ✅ Config (zod-validated), Prisma module, global filters/pipes/guards, throttling
- ✅ Auth: register/login, JWT access + rotating refresh, RBAC
- ✅ Google OAuth (id_token verify)
- 🟡 Apple Sign-in (JWKS signature verification still stubbed)
- ✅ Users: profile, GDPR export/erasure endpoints
- 🟡 GDPR export/erasure async jobs (endpoints record request; purge job TODO)
- ✅ Subscriptions: plans, entitlements, `EntitlementGuard` (server-side premium gate)
- ✅ Health check, Swagger docs
- ⬜ **[NEW]** Single active session enforcement for ADI role (see Phase 13)

---

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
- ⬜ **[NEW]** Video-less route support — GPX-only upload path (see Phase 14)
- ⬜ **[NEW]** Deferred video attach — different ADI can add video to existing route (Phase 14)

---

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
- ⬜ UK-English voice playback — client-side TTS concern (Flutter, Phase 10)

---

## Phase 4 — AI privacy & advanced sync  🟡 SCAFFOLDED
- 🟡 Face + number-plate blur (YOLO + OpenCV) — code present, gated off, untested
- ⬜ Train/select plate + face models; validate blur coverage on sample footage
- ⬜ Whisper transcription (captions / accessibility)
- ⬜ Sync fine-alignment from real optical-flow motion energy
- ⬜ Video validation on real merged file (black/frozen/corruption in pipeline)

---

## Phase 5 — Search & discovery  ✅ CORE DONE
- ✅ Route search (test centre / town / postcode / difficulty / contributor / instructor)
- ✅ Full-text search + instructor search boost
- ✅ Nearest test centres (PostGIS KNN)
- ⬜ Test-centre seed data (UK DVSA centres) for cold-start
- ⬜ Seed routes for major test centres (cold-start content)
- ⬜ Graduate to OpenSearch at scale
- ⬜ **[NEW]** Instructor search & discovery page (browse verified ADIs by area — Phase 13)

---

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
      (`POST /instructors/verify`) → admin verifies → role + badge + reputation boost
- 🟡 Credits currently informational; no spend/redemption mechanic yet
- ⬜ **[NEW]** ADI profile enrichment: lesson price, service areas, bio, availability (Phase 13)

---

## Phase 7 — Payments  ✅ CORE COMPLETE
- ✅ Plan definitions + entitlement model
- ✅ Stripe Checkout session creation (real; `StripeService`, plan→price mapping)
- ✅ Stripe webhook: raw-body signature verification + event→entitlement mapping
      (checkout.completed, subscription.created/updated/deleted, invoice.payment_failed)
- ✅ RevenueCat webhook: shared-secret auth + IAP event mapping
      (INITIAL_PURCHASE/RENEWAL/PRODUCT_CHANGE/CANCELLATION/EXPIRATION/BILLING_ISSUE)
- ✅ Subscription lifecycle: past_due grace, cancellation → free,
      every event persisted to `subscription_events` for reconciliation
- ✅ Usage quota / cost-control: per-tier monthly upload cap enforced on upload init
- 🟡 Refund handling (Stripe refunds logged via events; no automated entitlement change)
- ⬜ **[UPDATED]** Yearly price updated to £39.99 (was £29.99) — `subscriptions.service.ts` + paywall UI
- ⬜ **[NEW]** ADI lesson booking payment — Stripe Connect for instructor payouts (Phase 13)
- ⬜ **[NEW]** Platform service fee on bookings — split payment capture (Phase 13)
- ⬜ Live keys + real end-to-end purchase test (needs Stripe/RevenueCat accounts)

---

## Phase 8 — Instructor Community Fund  ✅ COMPLETE
- ✅ Explicit "net profit" formula (gross from active subs − assumed cost ratio)
- ✅ Automated monthly 10%-of-net-profit contribution via `@Cron` (idempotent per period)
- ✅ Fund ledger entries (contribution / allocation / payout) with balance tracking
- ✅ Beneficiaries management + payouts (balance-checked)
- ✅ Public transparency endpoints: `GET /fund/summary`, `GET /fund/reports?year=`
- ✅ Admin fund panel: balance, run-contribution, beneficiaries, payouts, transactions
- 🟡 Real net profit uses actual paid invoices (currently MRR-based estimate until
      live payment data flows)

---

## Phase 9 — Admin dashboard (React)  ✅ COMPLETE
- ✅ Login + auth token handling
- ✅ Modernised UI/UX — design token system, dark/light mode, WCAG AA accessible
- ✅ Sidebar layout + view routing + pending-review badge
- ✅ Review queue (table) + per-route detail drawer (stages, quality, videos)
- ✅ Per-route detail: pipeline-stage findings + quality breakdown + approve/reject
- ✅ User management (search, role change, suspend/reinstate)
- ✅ Instructor verification panel (verify/reject)
- ✅ Revenue panel (MRR estimate, plan/status breakdown)
- ✅ Fund management panel (ledger totals, allocation form, transactions)
- ✅ Reports panel (open user reports)
- 🟡 Revenue is local-data estimate until Stripe/RevenueCat webhooks land
- ⬜ GDPR actions from user panel (export/erase trigger — endpoints exist)
- ⬜ **[NEW]** Booking management panel — view/manage all instructor bookings (Phase 13)
- ⬜ **[NEW]** Platform service fee revenue in Revenue panel (Phase 13)
- ⬜ **[NEW]** Learner progress overview (aggregate stats per user) (Phase 15)

---

## Phase 10 — Flutter mobile app  🟡 CORE BUILT
- ✅ Project config, theming (M3, dark/light), `go_router`, Dio API client
      with bearer + auto token-refresh, secure token store
- ✅ Auth: email login/register; Google/Apple buttons (token exchange TODO)
- ✅ Home / discover (route list + pull-to-refresh)
- ✅ Search UI (query + difficulty filter)
- ✅ Route detail (preview + Watch/Practice, entitlement pre-check → paywall)
- ✅ Route player: `MasterTimelineController` (front/rear on one clock, offset-aware
      resync), Front/Rear/Split/Map views, scrubber, HUD, slow-motion
- ✅ Practice mode (timeline clock + UK-English `flutter_tts`, no video)
- ✅ Subscription paywall (plan cards; RevenueCat purchase flow TODO)
- ✅ Contribute: instructor-verification form (live API); upload flow placeholder
- ✅ Unit tests for model parsing
- 🟡 Playback Map view needs track-geometry (lat/lon) from API to draw route line
- ⬜ Social sign-in token exchange + RevenueCat purchase wiring
- ⬜ Resumable multi-clip upload (file_picker → presigned PUT → status polling)
- ⬜ Community screens (profile, badges, leaderboards)
- ⬜ **[NEW]** ADI in-app GPS recording screen — live track with start/stop (Phase 14)
- ⬜ **[NEW]** ADI booking screens — instructor search, availability, booking flow (Phase 13)
- ⬜ **[NEW]** Learner progress dashboard screen (Phase 15)
- ⬜ **[NEW]** AI learning summary card after watch/practice session (Phase 15)
- ⬜ **[NEW]** Offline download manager + encrypted playback (Phase 16)
- ⬜ `flutter analyze` / device run (needs Flutter SDK)

---

## Phase 11 — Cross-cutting: notifications, accessibility  ⬜ NOT STARTED
- ⬜ Notifications module (push FCM/APNs + email, BullMQ-driven)
- ⬜ Device token registration (`POST /notifications/register`)
- ⬜ Booking notification triggers (confirmed, reminder, cancelled)
- ⬜ Accessibility pass (captions, screen-reader labels, contrast)
- ⬜ Content moderation/abuse: user reports → moderation actions
- ⬜ Takedown request handling (privacy — missed blur reports)

---

## Phase 12 — Hardening & production  🟡 PARTIAL
- 🟡 CI/CD pipeline file exists; needs deploy stages wired
- ⬜ Dockerfiles (api, worker) + image builds
- ⬜ Observability: Sentry + OpenTelemetry instrumentation (config present, not wired)
- ⬜ Security review: signed-URL scoping, AV scan on upload, secrets manager
- ⬜ Load/perf: read replicas, PgBouncer, table partitioning, cache strategy
- ⬜ Resumable/multipart uploads for large clips
- ⬜ Test suites: API e2e, worker unit/integration, mobile widget tests
- ⬜ Deployment architecture (Fly.io/ECS), autoscaling worker pool

---

## Phase 13 — ADI Booking System  ⬜ NOT STARTED

> Learners can discover and book verified ADI instructors directly through the app.
> Instructors manage their own availability and lesson prices.

### 13a — DB schema additions
- ⬜ `instructor_profiles` table — lesson_price_minor, service_area_geom, bio, years_experience
- ⬜ `availability_slots` table — instructor_id, date, start_time, end_time, is_booked
- ⬜ `bookings` table — learner_id, instructor_id, slot_id, status (pending/confirmed/cancelled/completed)
- ⬜ `booking_payments` table — booking_id, amount_minor, platform_fee_minor, stripe_payment_intent_id
- ⬜ Prisma schema sync + migration

### 13b — API (NestJS module: `bookings`)
- ⬜ `GET  /instructors` — searchable by postcode radius, availability, price range
- ⬜ `GET  /instructors/:id/profile` — full public profile + available slots
- ⬜ `PUT  /instructors/me/profile` — ADI updates price, bio, service area
- ⬜ `POST /instructors/me/availability` — ADI sets weekly availability slots
- ⬜ `DELETE /instructors/me/availability/:id` — remove a slot
- ⬜ `POST /bookings` — learner creates booking (initiates Stripe payment)
- ⬜ `GET  /bookings/mine` — learner views their bookings
- ⬜ `GET  /instructors/me/bookings` — ADI views incoming bookings
- ⬜ `PATCH /bookings/:id` — ADI accepts / declines / cancels
- ⬜ `GET  /admin/bookings` — admin overview (all bookings)
- ⬜ Stripe Connect: instructor onboarding, payment split (lesson fee → instructor, platform fee → RouteSync)
- ⬜ Platform service fee configuration (fixed or percentage, stored in config)
- ⬜ Booking confirmation email (BullMQ job → SendGrid/SES)

### 13c — Admin console additions
- ⬜ Bookings panel — view all bookings, filter by status/date/instructor
- ⬜ Platform fee revenue in Revenue panel (separate line from subscription MRR)
- ⬜ Stripe Connect payout dashboard (instructor onboarding status)

### 13d — Web app additions (`apps/web`)
- ⬜ Instructor search page — map + list view, filters (area, price, rating)
- ⬜ Instructor profile page — bio, routes contributed, available slots, book button
- ⬜ Booking flow — date/time picker → payment (Stripe Checkout or Payment Element)
- ⬜ My bookings page — upcoming + history

### 13e — Flutter mobile additions
- ⬜ Instructor discovery screen (list + map, filters)
- ⬜ Instructor profile screen
- ⬜ Booking flow (slot selector → confirm → IAP/Stripe payment)
- ⬜ My bookings screen (learner + ADI views)
- ⬜ ADI availability management screen
- ⬜ ADI lesson price + bio settings screen

---

## Phase 14 — ADI In-App GPS Recording & Video-less Routes  ⬜ NOT STARTED

> ADIs can record a GPS track live from their phone while driving a test route.
> The system auto-detects start and end points. Video can be added later by any ADI.

### 14a — DB schema additions
- ⬜ `route_status` enum — add `map_only` state (GPS published, video pending)
- ⬜ `routes.video_contributor_id` — nullable FK to the ADI who later added the video
      (may differ from the original GPS contributor)
- ⬜ `routes.has_video` boolean — computed flag for UI filtering

### 14b — Live GPS recording (Flutter)
- ⬜ "Start recording route" button visible only to `role = instructor` users
- ⬜ Background GPS track recording using device location services
- ⬜ Live map display showing the track being drawn in real time
- ⬜ Auto-detect route start point (first GPS fix after recording starts)
- ⬜ Auto-detect route end point (last GPS fix on stop, or detected return to test centre)
- ⬜ "Stop & save" — exports GPX, uploads to API, route enters `map_only` state
- ⬜ Optional: set route title, difficulty, and target test centre before saving

### 14c — Video-less route pipeline (API + worker)
- ⬜ Upload init: accept GPX-only payload (no front/rear required)
- ⬜ Worker: run GPS validation + navigation + markers on GPX-only upload
- ⬜ Worker: skip all video stages gracefully; mark route as `map_only` on completion
- ⬜ Route published in `map_only` state — visible to learners for map-mode practice
- ⬜ API: `POST /routes/:id/attach-video` — any verified ADI can attach video to an
      existing `map_only` route (creates a new upload linked to the existing route_id)
- ⬜ Worker: when video upload completes for existing route, run video-only stages
      (merge, HLS, sync engine, privacy blur) then upgrade route status to `published`
- ⬜ Notify original GPS contributor when video is attached to their route

### 14d — Web app additions
- ⬜ "Contribute video to existing route" button on map-only route detail pages
- ⬜ Upload flow variant: select existing route + upload front/rear videos only

### 14e — Admin console additions
- ⬜ Review queue: show `map_only` routes separately with a "video pending" label
- ⬜ Ability to approve a `map_only` route for map-only practice access

---

## Phase 15 — Learner Progress Tracking & AI Learning Summaries  ⬜ NOT STARTED

> Track each learner's journey through routes. Generate AI-powered post-session
> summaries to reinforce learning and guide where to focus next.

### 15a — DB schema additions
- ⬜ `user_route_history` table — user_id, route_id, watch_count, practice_count,
      last_watched_at, last_practised_at, watch_pct_max (furthest point reached)
- ⬜ `user_progress` table — user_id, total_routes_watched, total_practice_runs,
      total_watch_time_s, current_streak_days, last_active_at
- ⬜ `ai_summaries` table — user_id, route_id, session_type (watch/practice),
      summary_text, focus_areas (JSONB), generated_at

### 15b — API additions
- ⬜ Progress tracking middleware — record watch/practice events on playback + practice endpoints
- ⬜ `GET  /users/me/progress` — overall learner dashboard stats
- ⬜ `GET  /users/me/history` — routes watched + practised with completion %
- ⬜ `POST /routes/:id/session-complete` — client fires on session end; triggers AI summary job
- ⬜ `GET  /routes/:id/summary` — retrieve generated AI summary for this user + route
- ⬜ AI summary BullMQ job: calls LLM (OpenAI GPT-4o / Gemini) with route instructions
      + session metadata → structured summary (key junctions, recommended focus, encouragement)
- ⬜ LLM provider config (provider-agnostic interface; default OpenAI, swap to Gemini easily)
- ⬜ AI summary caching (one summary per user+route+session_type; regenerate if route updated)

### 15c — Web app additions
- ⬜ Progress dashboard page (`/account/progress`) — stats cards + route history list
- ⬜ AI summary card shown after completing a watch or practice session
- ⬜ Route history visible on route detail page ("You've practised this 3 times")

### 15d — Flutter mobile additions
- ⬜ Progress screen under Account tab — streak, total routes, total practice time
- ⬜ AI summary bottom sheet after finishing a watch/practice session
- ⬜ Route cards show personal completion badge if previously practised

---

## Phase 16 — Offline Route Packages  ⬜ NOT STARTED

> Premium users download encrypted route packages to their device.
> Files are account-bound, non-exportable, and expire on subscription lapse.

### 16a — DB (schema exists — `offline_packages` table already present)
- ⬜ Add `offline_packages.device_id` — bind package to registered device
- ⬜ Add `offline_packages.checksum` — integrity verification on device

### 16b — API additions
- ⬜ `POST /routes/:id/offline` — generate + encrypt offline package (premium gate)
- ⬜ Package builder worker job (BullMQ): fetch HLS segments + GPX + instructions +
      markers → bundle → AES-256 encrypt with user+device key → upload to R2 → record in DB
- ⬜ `GET  /routes/:id/offline` — return signed download URL (short-lived, single-use)
- ⬜ `DELETE /routes/:id/offline` — revoke package (e.g. on subscription cancel)
- ⬜ `GET  /users/me/offline` — list all downloaded routes
- ⬜ Automatic package revocation job on subscription cancellation/expiry
- ⬜ Security: packages encrypted per-user+device; server holds no plaintext

### 16c — Flutter mobile additions
- ⬜ Download manager (background Dio download + progress indicator)
- ⬜ Downloaded routes list on Account screen
- ⬜ Offline-aware player — detects no internet, uses local decrypted package
- ⬜ Device registration + key exchange on first offline download
- ⬜ Expiry check on app open — remove expired packages gracefully

### 16d — Web app (limited offline)
- ⬜ Web offline scope: GPX + instructions only (no video due to browser storage limits)
- ⬜ Service worker caches instructions + map tiles for offline practice mode

---

## Phase 17 — ADI Single-Session Security  ✅ COMPLETE

> One ADI licence = one account = one active login at a time.
> New login on Device B immediately invalidates Device A's session.

### 17a — API changes
- ✅ `auth.service.ts`: on login for `role = instructor`, revokes all existing refresh tokens
- ✅ Session invalidation: existing tokens return `401 SESSION_INVALIDATED` distinct message
- ✅ Unique ADI licence constraint added to `instructor_verifications` in `schema.sql`
- ⬜ Admin console: show active session count per ADI

### 17b — Client changes (Flutter + Web)
- ✅ Web `client.ts`: detects `SESSION_INVALIDATED`, clears tokens, fires DOM event
- ✅ Web `AuthContext.tsx`: listens for event, sets `sessionInvalidated` state
- ✅ Web `LoginPage.tsx`: shows "signed out on another device" banner
- ⬜ Flutter: handle `SESSION_INVALIDATED` 401 variant

---

## Phase 18 — Pricing & Subscription Corrections  ✅ COMPLETE

- ✅ `apps/api/src/modules/subscriptions/subscriptions.service.ts` — updated `premium_yearly` `priceMinor` to `3999` (£39.99)
- ✅ `apps/web/src/pages/PaywallPage.tsx` — updated displayed price + booking note + features list
- ✅ `apps/mobile/lib/features/subscription/paywall_screen.dart` — price + booking note + AI insights feature
- ✅ Added `aiInsights` to premium entitlements object
- ✅ Added "booking does not require Premium" note on paywall and account pages
- ✅ ADI upgrade option shown on AccountPage

---

## Progress Snapshot (2026-07-16)

| Phase | Area | Status | Completion |
|---|---|---|---|
| 0 | Foundations & design | ✅ Complete | 100% |
| 1 | Backend core | ✅ Mostly done | ~85% |
| 2 | Upload → playback | ✅ Mostly done | ~90% |
| 3 | Practice mode & maps | ✅ Core done | ~85% |
| 4 | AI privacy & sync | 🟡 Scaffolded | ~20% |
| 5 | Search & discovery | ✅ Core done | ~70% |
| 6 | Community & contributor | ✅ Mostly done | ~90% |
| 7 | Payments | ✅ Core done | ~80% |
| 8 | Community Fund | ✅ Complete | ~90% |
| 9 | Admin dashboard | ✅ Complete | ~90% |
| 10 | Flutter mobile app | 🟡 Core built | ~55% |
| 11 | Notifications & a11y | 🟡 Module built | ~40% |
| 12 | Hardening & production | 🟡 Partial | ~30% |
| **13** | **ADI Booking System** | 🟡 **Core DB+API+Web built** | **~55%** |
| **14** | **In-app GPS recording & video-less routes** | 🟡 **Pipeline + API + Web built** | **~60%** |
| **15** | **Learner progress & AI summaries** | 🟡 **DB+API+Web built** | **~60%** |
| **16** | **Offline route packages** | 🟡 **DB+API built** | **~50%** |
| **17** | **ADI single-session security** | ✅ **Complete** | **~90%** |
| **18** | **Pricing corrections** | ✅ **Complete** | **100%** |

---

## Recommended Build Order

```
Phase 18  →  Pricing fix (trivial, do today)
Phase 17  →  Single-session ADI security (small, foundational for Phase 13)
Phase 14  →  GPS recording + video-less routes (unblocks new content supply)
Phase 13  →  ADI booking system (largest new workstream — db, api, ui, payments)
Phase 15  →  Progress tracking + AI summaries (requires routes + sessions in place)
Phase 16  →  Offline packages (requires stable video pipeline + subscriptions)
Phase 10  →  Complete Flutter wiring (social auth, IAP, upload, offline, community)
Phase 11  →  Notifications (booking confirmations, progress nudges)
Phase 4   →  AI privacy blur production-ready (requires test footage)
Phase 12  →  Hardening, Dockerfiles, observability, load testing
```

---

## Key Architectural Decisions for New Phases

| Decision | Choice | Reason |
|---|---|---|
| Instructor payments | Stripe Connect (Express) | Enables split payments — lesson fee to ADI, platform fee to RouteSync, all in one Checkout session |
| Platform service fee | Configurable % or flat fee stored in `platform_config` table | Allows fee to be adjusted without code deploy |
| LLM for AI summaries | OpenAI GPT-4o (primary) / Gemini (fallback) | Provider-agnostic interface; summaries are low-latency background jobs |
| Live GPS recording | Flutter `geolocator` package, background location | Already in pubspec; background mode needs `background_locator_2` addition |
| Offline encryption | AES-256-GCM, key = HKDF(user_id + device_id + route_id) | Key never leaves server; device requests decrypt key per-session via short-lived signed token |
| Single-session for ADIs | Revoke all prior refresh tokens on ADI login | Simplest correct approach; no concurrent session complexity |
