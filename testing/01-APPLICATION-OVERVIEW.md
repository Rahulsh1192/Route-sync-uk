# 01 — Application Overview

Derived from the implementation. Source files are linked throughout.

---

## 1. Purpose

Test Routify is a UK driving-test preparation platform.

A learner picks a **DVSA test centre**, browses the **driving routes** recorded around
that centre, and either:

- **Watches** the route — front and rear dashcam video, GPS-synchronised, with a map
  marker that moves along the recorded track as the video plays; or
- **Practises** the route — turn-by-turn spoken instructions in UK English, no video.

Learners can also **book a driving lesson** with a verified instructor.

Verified driving instructors (**ADIs**) contribute the footage: they record a drive
against a **reference route (R1)**, upload dashcam video plus GPS logs, and a media
worker processes it. Admins/moderators then review and publish it.

---

## 2. System shape

| Piece | Technology | Where |
|---|---|---|
| Web app (learner + instructor + admin console) | React + Vite | [apps/web/](../apps/web/) |
| Business API | NestJS (TypeScript) | [apps/api/](../apps/api/) |
| Media / AI worker | Python (FFmpeg, OpenCV, Whisper) | [services/worker/](../services/worker/) |
| Mobile app | Flutter | [apps/mobile/](../apps/mobile/) |
| Database | PostgreSQL 16 + PostGIS | [db/schema.sql](../db/schema.sql) |
| Cache / queue | Redis | — |
| Object storage | MinIO (local) / Cloudflare R2 (prod) | — |

**Scope of this test pack: the web application and the API behind it.**
The Flutter mobile app and the Python worker are out of scope — see
[13-TESTING-GAPS.md](13-TESTING-GAPS.md).

---

## 3. Conceptual flow

The application does **not** follow a simple "module → feature → action" hierarchy.
Its actual model is *entitlement-gated content, plus role-gated contribution*:

```
Registration / Login  (no anonymous access — every page except the email-link
        |              pages requires a session)
        v
Role-based landing    (admin & moderator -> /admin ; everyone else -> /test-centres)
        |
        +--> Test Centre  ------> Driving Routes at that centre
        |                              |
        |                              v
        |                        Access decision
        |                        (per-centre Premium? OR the account's one
        |                         free demo route? -> allow ; else -> PAYWALL)
        |                              |
        |                    +---------+---------+
        |                    v                   v
        |               Watch (video+map)   Practice (voice)
        |
        +--> Book a lesson --> Instructor search -> Slot -> Booking -> Payment record
        |
        +--> Contribute (instructor/admin only)
                 |
                 v
           Reference route (R1) -> Record drive (journey) -> Upload footage
                 |
                 v
           Worker processing -> Review Queue -> Admin approves -> Published route
                                                                    |
                                                                    v
                                                          visible to learners
```

---

## 4. Authentication mechanism

Implemented in [apps/api/src/modules/auth/](../apps/api/src/modules/auth/).

- **Email + password.** Passwords hashed with bcrypt (cost 12).
  Minimum password length **8** ([auth.dto.ts](../apps/api/src/modules/auth/dto/auth.dto.ts)).
- **JWT bearer tokens.** An **access token** (`JWT_ACCESS_SECRET`, default TTL **900 s**)
  carrying `{ sub, role, email }`, and a **refresh token** (`JWT_REFRESH_SECRET`, default
  TTL **2 592 000 s / 30 days**) whose SHA-256 hash is stored in `refresh_tokens`.
- **Refresh rotation.** `POST /api/auth/refresh` revokes the presented token and issues a
  new pair.
- **Single session for instructors.** Every login by a user whose role is `instructor`
  revokes all their other refresh tokens
  ([auth.service.ts](../apps/api/src/modules/auth/auth.service.ts) — `enforceSingleSessionIfInstructor`).
  A revoked-then-refreshed token returns the literal message `SESSION_INVALIDATED`.
- **Google / Apple sign-in.** Endpoints exist and are implemented, but the web app ships
  **no** Google/Apple buttons — see [13-TESTING-GAPS.md](13-TESTING-GAPS.md).
- **Email verification and password reset** (single-use, hashed tokens; verification link
  valid **24 h**, reset link valid **1 h**).
- **Suspended accounts** cannot log in — `Account suspended`.
- **Tokens are stored in `localStorage`** under `rs_access` / `rs_refresh`
  ([apps/web/src/api/client.ts](../apps/web/src/api/client.ts)).

There is **no anonymous browsing** in the web app. Only `/login`, `/forgot-password`,
`/reset-password` and `/verify-email` render without a session
([apps/web/src/App.tsx](../apps/web/src/App.tsx)).

> Note: several **API** endpoints are unauthenticated even though the UI never reaches
> them without a session (e.g. `GET /api/test-centres`, `GET /api/routes`,
> `GET /api/fund/summary`). See [03-ACCESS-CONTROL-MATRIX.md](03-ACCESS-CONTROL-MATRIX.md).

---

## 5. Authorization mechanism

Three distinct layers. Test all three separately —
[06-NEGATIVE-TESTING.md](06-NEGATIVE-TESTING.md) covers the bypass cases.

| Concept | Question it answers | Implementation |
|---|---|---|
| **Authentication** | Who is the user? | `JwtAuthGuard` + `JwtStrategy` — a valid bearer access token |
| **Authorization** | What may this role do? | `RolesGuard` + `@Roles(...)` decorator ([roles.guard.ts](../apps/api/src/common/guards/roles.guard.ts)) |
| **Entitlement** | Has this user paid for this content? | `resolveAccess()` in [routes.service.ts](../apps/api/src/modules/routes/routes.service.ts); `EntitlementGuard` + `@RequirePremium()` also exists ([entitlement.guard.ts](../apps/api/src/common/guards/entitlement.guard.ts)) |
| **Access scope** | Whose data can this user see? | Per-handler ownership checks — e.g. `getOwned()` in uploads, `learner_id = :me` in bookings |

Additional guard:

- **`WorkerSecretGuard`** ([worker-secret.guard.ts](../apps/api/src/common/guards/worker-secret.guard.ts))
  protects `POST /api/internal/journeys/analyse-upload`. It authenticates the Python
  worker via an `x-worker-secret` header. If `WORKER_SHARED_SECRET` is unset the endpoint
  returns **503**, never open access.

Front-end guards ([apps/web/src/App.tsx](../apps/web/src/App.tsx)):

- `Protected` — redirects to `/login` when there is no session.
- `AdminProtected` — requires a session **and** role `admin` or `moderator`; anything else
  is redirected to `/test-centres`.
- `RoleLanding` — on `/`, sends `admin`/`moderator` to `/admin`, everyone else to
  `/test-centres`.

**Front-end guards are cosmetic.** The API enforces the real rules. Every
front-end restriction must be re-tested at API level.

---

## 6. Navigation

Navigation is role-dependent, driven by `isStaffRole(role)` which is **`instructor` or
`admin` only** ([apps/web/src/api/types.ts](../apps/web/src/api/types.ts),
[apps/web/src/components/Layout.tsx](../apps/web/src/components/Layout.tsx)).

**Learner navigation** (roles `user`, `contributor`, **and `moderator`**):

| Desktop header | Bottom tab bar (mobile) |
|---|---|
| Test Centres · Discover Routes · Book a Driving Instructor · My Bookings · Account | Test Centres · Discover · Book a Lesson · Account |

**Staff navigation** (roles `instructor`, `admin`):

| Desktop header | Bottom tab bar (mobile) |
|---|---|
| Test Centres · Discover Routes · My Lessons · Contribute · Account | Test Centres · Discover · Contribute · Account |

**Admin console** ([apps/web/src/admin/AdminApp.tsx](../apps/web/src/admin/AdminApp.tsx))
renders its own sidebar with no learner shell:
Review Queue · Users · Instructors · Bookings · Reference Routes · Revenue ·
Community Fund · Instructor Earnings · Reports, plus "Main app" and "Sign out".

> **Test this:** a `moderator` lands on `/admin` but, if they click "Main app", gets the
> **learner** navigation — no Contribute tab. That is what the code does. Whether it is
> intended is `Needs Clarification` ([13-TESTING-GAPS.md](13-TESTING-GAPS.md)).

---

## 7. URL path inventory (web)

From [apps/web/src/App.tsx](../apps/web/src/App.tsx).

| Path | Page | Guard |
|---|---|---|
| `/login` | Landing + sign-in / register | Public; redirects to `/` if already signed in |
| `/forgot-password` | Request reset link | Public, **not** redirected when signed in |
| `/reset-password?token=` | Set new password | Public, **not** redirected when signed in |
| `/verify-email?token=` | Confirm email | Public, **not** redirected when signed in |
| `/` | Role landing (redirect only) | Authenticated |
| `/admin` | Admin console | Authenticated + `admin`/`moderator` |
| `/test-centres` | Test centre list | Authenticated |
| `/test-centres/new` | Create centre form | Authenticated (UI button only for staff) |
| `/test-centres/:id` | Centre detail + its routes | Authenticated |
| `/test-centres/:id/edit` | Edit centre form | Authenticated (UI button only for staff) |
| `/discover` | Global route search | Authenticated |
| `/route/:id` | Route detail + access decision | Authenticated |
| `/route/:id/watch` | Player (video + map), lazy-loaded | Authenticated + entitlement |
| `/route/:id/practice` | Voice practice, lazy-loaded | Authenticated + entitlement |
| `/paywall` | Plan selection → Stripe checkout | Authenticated |
| `/billing/success`, `/billing/cancel` | Stripe return pages | Authenticated |
| `/account` | Account, contact details, role actions | Authenticated |
| `/account/progress` | Progress and route history | Authenticated |
| `/contribute` | Contributor hub | Authenticated |
| `/contribute/upload` | 4-step upload wizard | Authenticated (content staff-gated) |
| `/contribute/uploads/:id` | Upload status | Authenticated |
| `/contribute/instructor` | ADI verification application | Authenticated |
| `/contribute/record` | Record a drive | Authenticated (content staff-gated) |
| `/instructors/find` | Instructor search | Authenticated |
| `/instructors/me` | Instructor dashboard ("My lessons") | Authenticated |
| `/instructors/:id` | Public instructor profile | Authenticated |
| `/bookings` | Learner's bookings | Authenticated |
| `/search` | → redirects to `/discover` | — |
| `/instructors` | → redirects to `/` | — |
| `/test-details` | → redirects to `/` | — |
| anything else | → `/` when signed in, `/login` otherwise | — |

---

## 8. Module inventory

| Module | Purpose | Web path | API base | Roles that can act | Test doc |
|---|---|---|---|---|---|
| Authentication | Register, login, tokens, verify email, reset password | `/login`, `/verify-email`, `/forgot-password`, `/reset-password` | `/api/auth/*` | All | [04](04-AUTHENTICATION-TESTING.md) |
| Test Centres | Browse / search centres; staff CRUD | `/test-centres*` | `/api/test-centres` | Read: all · Write: `instructor`, `admin` | [modules/test-centres.md](modules/test-centres.md) |
| Discovery & Search | Global search across routes | `/discover` | `/api/routes`, `/api/search/*` | All | [modules/route-discovery-search.md](modules/route-discovery-search.md) |
| Route Access & Paywall | Decide whether a learner may open a route | `/route/:id`, `/paywall` | `/api/routes/:id/access` | All | [modules/route-detail-access-paywall.md](modules/route-detail-access-paywall.md) |
| Playback & Practice | Watch video + map; voice practice | `/route/:id/watch`, `/route/:id/practice` | `/api/routes/:id/playback`, `/practice`, `/track`, `/hls/...` | All (entitlement-gated) | [modules/route-playback-practice.md](modules/route-playback-practice.md) |
| Subscriptions & Billing | Plans, Stripe checkout, webhooks | `/paywall`, `/billing/*` | `/api/subscriptions/*`, `/api/webhooks/stripe` | All | [modules/subscriptions-billing.md](modules/subscriptions-billing.md) |
| Account & Profile | Display name, contact details, GDPR export/erase | `/account` | `/api/users/me*` | All | [modules/account-profile.md](modules/account-profile.md) |
| Progress & History | Watched/practised history, AI summaries | `/account/progress` | `/api/users/me/progress`, `/history` | All | [modules/progress-history.md](modules/progress-history.md) |
| Bookings (learner) | Find instructor, book slot, cancel | `/instructors/find`, `/bookings` | `/api/instructors`, `/api/bookings*` | All | [modules/bookings.md](modules/bookings.md) |
| Instructor Dashboard | Own profile, availability slots, received bookings | `/instructors/me` | `/api/instructors/me/*` | `instructor` | [modules/instructor-dashboard.md](modules/instructor-dashboard.md) |
| Instructor Verification | ADI application + badge evidence | `/contribute/instructor` | `/api/instructors/verify*` | `user`, `contributor` apply | [modules/instructor-verification.md](modules/instructor-verification.md) |
| Contribute / Uploads | 4-step dashcam upload wizard | `/contribute/upload` | `/api/uploads*` | `instructor`, `admin` | [modules/contribute-uploads.md](modules/contribute-uploads.md) |
| Record a Drive | Live GPS journey against an R1 | `/contribute/record` | `/api/journeys*` | `instructor`, `admin` | [modules/record-drive-journeys.md](modules/record-drive-journeys.md) |
| Reference Routes (R1) | Define the canonical route geometry | Admin → Reference Routes | `/api/reference-routes` | `instructor`, `admin` | [modules/reference-routes.md](modules/reference-routes.md) |
| Admin — Review Queue | Approve / reject submitted routes | `/admin` → Review Queue | `/api/admin/review-queue`, `/routes/:id/moderate` | `admin`, `moderator` | [modules/admin-review-queue.md](modules/admin-review-queue.md) |
| Admin — Users | Search users, change role, suspend | `/admin` → Users | `/api/admin/users` | Read: `admin`,`moderator` · Write: `admin` | [modules/admin-users.md](modules/admin-users.md) |
| Admin — Instructors | Review ADI applications, view evidence | `/admin` → Instructors | `/api/admin/instructors*` | `admin`, `moderator` | [modules/admin-instructors.md](modules/admin-instructors.md) |
| Admin — Bookings | All bookings across the platform | `/admin` → Bookings | `/api/admin/bookings` | `admin`, `moderator` | [modules/admin-bookings.md](modules/admin-bookings.md) |
| Admin — Finance & Reports | Revenue, Community Fund, Instructor Earnings, abuse reports | `/admin` → Revenue / Fund / Earnings / Reports | `/api/admin/revenue`, `/fund/*`, `/revshare/*`, `/reports` | Mixed — see matrix | [modules/admin-finance-and-reports.md](modules/admin-finance-and-reports.md) |
| API-only modules | Notifications, offline packages, community/leaderboards, public fund, health, webhooks | *(no web UI)* | `/api/notifications`, `/api/routes/:id/offline`, `/api/badges`, `/api/leaderboards`, `/api/fund/*`, `/api/health` | Varies | [modules/api-only-modules.md](modules/api-only-modules.md) |

---

## 9. Inter-module dependencies

These are the couplings that make ordering matter when testing.

| This module | Depends on | Why |
|---|---|---|
| Routes | Test Centres | Every route has a `test_centre_id`; upload requires one |
| Route access | Subscriptions | Premium is **per test centre**; entitlement is checked against the route's centre |
| Route access | Demo claim | The first route an account opens is claimed permanently in `demo_route_claims` |
| Playback | Worker output | `route_videos`, `route_track_points`, `route_markers`, `route_previews` are written by the media worker |
| Review Queue | Uploads | Only routes in `in_review` / `flagged` appear |
| Published route | Community | Approving a route awards credits/reputation/badges to the contributor |
| Bookings | Instructor verification | Only `role = instructor` **and** `contributors.instructor_status = 'verified'` appear in instructor search |
| Bookings | Instructor availability | A booking consumes an `availability_slots` row and flips `is_booked` |
| Booking price | `platform_config.booking_fee_pct` | Platform fee, default **10 %** |
| Instructor role | Admin verification | Approving an ADI application sets `users.role = 'instructor'` |
| Upload | Contributor agreement | `POST /api/uploads` is refused until the footage agreement is accepted |
| Upload conformance | Reference route + worker secret | Without `WORKER_SHARED_SECRET`, conformance is skipped |
| Test centre delete | Routes | A centre with routes cannot be deleted |
| Instructor search | postcodes.io | Proximity search geocodes the learner's postcode via an external service |
| Test centre create | postcodes.io | Creation fails with 503 if the postcode service is unreachable |

---

## 10. Key business rules discovered in code

These are the rules a tester must know; each is traced to its source.

1. **Premium is per test centre, and is not switchable.**
   `isPremiumForCentre()` in [subscriptions.service.ts](../apps/api/src/modules/subscriptions/subscriptions.service.ts).
   A subscription with `testCentreId = NULL` is a legacy/universal grant that unlocks everything.
2. **One free demo route per account, ever — across all centres.**
   The first route the account actually opens (playback / practice / track) is written to
   `demo_route_claims` and becomes the only free route. Every other route then returns
   `PAYWALL`. `resolveAccess()` in [routes.service.ts](../apps/api/src/modules/routes/routes.service.ts).
   `GET /api/routes/:id/access` is a **dry run** and does not claim.
3. **Plans and prices.** Free (£0), Premium Monthly **£4.99**, Premium Yearly **£39.99**
   — `plans()` in subscriptions.service.ts.
   ⚠ The Revenue panel's MRR calculation uses **£29.99** for yearly, not £39.99 —
   see [13-TESTING-GAPS.md](13-TESTING-GAPS.md).
4. **Only published, non-deleted routes are visible** to learners
   (`status = 'published' AND deleted_at IS NULL`) — everywhere in routes.service.ts.
5. **Video is never public.** Playback issues an HMAC-signed, user- and route-bound,
   expiring token embedded in the URL *path*; each HLS asset is authorised through
   `GET /api/routes/:id/hls/:token/:view/:file`.
6. **Instructors are limited to one active session.**
7. **Free contributors may upload 3 routes per month**; premium is unlimited
   (`FREE_MONTHLY_UPLOAD_CAP` in [uploads.service.ts](../apps/api/src/modules/uploads/uploads.service.ts)).
8. **Max upload file size 5 GB per clip**; allowed video types `video/mp4`,
   `video/quicktime`, `video/x-matroska`.
9. **ADI badge evidence** must be JPEG/PNG/WebP/HEIC/PDF, max **15 MB**.
   An **expired** ADI expiry date is rejected at submission.
   An ADI number already registered to another account is rejected as a conflict.
10. **Booking platform fee** = `platform_config.booking_fee_pct`, default **10 %**,
    added on top of the instructor's own price (default **£35.00** if unset).
11. **Instructor proximity search** is capped at **40 km** regardless of the radius the
    instructor set; `elsewhere` results are only returned when `nearby` is empty.
12. **Route moderation:** approve → `published` (+ `published_at`, + community credits);
    reject → `rejected`. Both write an `approvals` row and an `audit_log` row.
13. **Password reset revokes every session** for that user.
14. **`POST /api/auth/forgot-password` always returns 202**, whether or not the address
    exists — deliberate, to prevent account enumeration.
15. **Rate limits.** Global throttle **120 requests / minute / IP**. Tighter per-endpoint:
    resend verification 3/min, verify-email 10/min, forgot-password 5/min,
    reset-password 10/min. Plus a per-account cap of **5 emails per rolling hour**.
</content>
