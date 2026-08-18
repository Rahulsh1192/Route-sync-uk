# 12 — Test Environment and Test Data

Everything QA needs to prepare before executing a single test case.

> **Security note.** The accounts in §3 are **local development seed accounts**. Their
> passwords are already committed in plain text inside [db/seed.sql](../db/seed.sql),
> [db/seed_more.sql](../db/seed_more.sql) and [db/seed_booking_test.sql](../db/seed_booking_test.sql),
> so listing them here discloses nothing new. **They must never be created in, or used
> against, a production environment.** No third-party API keys, secrets or production
> credentials appear anywhere in this folder — for those, see the value-free
> [docs/THIRD_PARTY_CREDENTIALS.md](../docs/THIRD_PARTY_CREDENTIALS.md) and ask the
> platform owner.

---

## 1. Environments

| | **Local** (recommended for functional testing) | **Deployed** |
|---|---|---|
| Web app | `http://localhost:5174` | `https://<project>.vercel.app` — **`Needs Clarification`**: the repo only ever refers to a placeholder `*.vercel.app` URL. Ask the platform owner for the real host |
| Admin console | `http://localhost:5174/admin` | `<web host>/admin` |
| API | `http://localhost:3000` | `https://routesync-api.onrender.com` (per [docs/DEPLOY_STEP_BY_STEP.md](../docs/DEPLOY_STEP_BY_STEP.md)) |
| Swagger / API docs | `http://localhost:3000/docs` | `<api host>/docs` |
| Health check | `http://localhost:3000/api/health` | `<api host>/api/health` |
| Database | Postgres+PostGIS in Docker, host port **5434** | Supabase |
| Object storage | MinIO — API `:9000`, console `:9001` | Cloudflare R2 |
| Cache / queue | Redis `:6379` | Managed Redis |
| API routing | Vite dev-server proxy: `/api` → `localhost:3000` ([vite.config.ts](../apps/web/vite.config.ts)) | Vercel rewrite: `/api/:path*` → the Render API ([apps/web/vercel.json](../apps/web/vercel.json)) |

The test **steps** in this pack are identical on both environments. Only the base URL
changes.

### 1.1 Differences to expect on the deployed environment

| Difference | Consequence for testing |
|---|---|
| Seed accounts may not exist | Every credential in §3 may be absent. Confirm with the platform owner before assuming a login failure is a defect |
| Real Stripe keys may be present | A checkout may attempt a real charge. **Do not run `SUB-004`/`SUB-005` on the deployed environment unless the owner confirms Stripe is in test mode** |
| Outbound email may be configured | Email verification and password reset become testable |
| Database migrations may lag | [docs/PROJECT_STATUS.md](../docs/PROJECT_STATUS.md) flags Supabase migrations past phase 20 as not applied. If a page 500s on the deployed environment but works locally, suspect a missing migration before raising a functional bug |
| `WORKER_SHARED_SECRET` may be unset | Upload conformance analysis is skipped; uploaded routes get flagged |

---

## 2. Local setup

Full, verified instructions are in [docs/RUNNING_LOCALLY.md](../docs/RUNNING_LOCALLY.md).
The short version, run from the repository root in Git Bash:

```bash
# 1. Infrastructure (Postgres+PostGIS, Redis, MinIO)
docker compose -f infra/docker-compose.yml up -d

# 2. Schema, migrations and seed data — ONCE ONLY
until docker exec infra-postgres-1 pg_isready -U routesync >/dev/null 2>&1; do sleep 1; done
for f in schema.sql migrate_phases_13_17.sql \
         migrate_phase_19.sql migrate_phase_19b.sql migrate_phase_19c.sql \
         migrate_phase_20.sql migrate_phase_21.sql migrate_phase_22.sql \
         migrate_phase_23.sql migrate_phase_24.sql migrate_phase_25.sql \
         migrate_phase_26.sql migrate_phase_27.sql migrate_phase_28.sql \
         seed.sql seed_more.sql seed_booking_test.sql seed_test_centres_demo.sql; do
  echo "loading db/$f"
  docker exec -i infra-postgres-1 psql -U routesync -d routesync -v ON_ERROR_STOP=1 < "db/$f" \
    || { echo "FAILED on $f"; break; }
done

# 3. API  (leave running)
cd apps/api && cp .env.example .env && npm install && npm run prisma:generate
#    edit apps/api/.env  ->  DATABASE_URL=postgresql://routesync:routesync@localhost:5434/routesync?schema=public
npm run start:dev

# 4. Web app  (new terminal, leave running)
cd apps/web && npm install && npm run dev
```

> ⚠ [docs/RUNNING_LOCALLY.md](../docs/RUNNING_LOCALLY.md) currently lists migrations only
> up to `migrate_phase_20.sql`. The repository contains migrations through
> `migrate_phase_28.sql`, and features such as email verification, the clip timeline and
> Phase 26 contact fields **need them**. Use the list above. Raised as a documentation
> defect in [13-TESTING-GAPS.md](13-TESTING-GAPS.md).

**Verify the environment is up before testing anything:**

1. `http://localhost:3000/api/health` returns `{"status":"ok","db":"up",…}`.
2. `http://localhost:3000/docs` renders Swagger.
3. `http://localhost:5174` shows the branded landing page.
4. Signing in as the admin account lands on `/admin` with non-zero stat tiles.

---

## 3. Test accounts (local seed data only)

All seeded accounts use the same password: **`Password123!`**

| # | Email | Password | Role | `instructor_status` | Subscription | Use it to test |
|---|---|---|---|---|---|---|
| 1 | `admin@routesync.uk` | `Password123!` | `admin` | none | premium_yearly (universal) | Full admin console, all admin-only actions |
| 2 | `demo@routesync.uk` | `Password123!` | `admin` | none | premium_yearly (universal) | Second admin; **owns almost all seeded routes** |
| 3 | `instructor@routesync.uk` | `Password123!` | `instructor` | **verified** (`ADI12345`) | free | Instructor dashboard, availability, uploads, single-session rule |
| 4 | `learner@routesync.uk` | `Password123!` | `user` | — | free | The default learner journey, paywall, demo-route rule |
| 5 | `james.carter@example.com` | `Password123!` | `contributor` | **pending** (`ADI78341`) | free | Pending ADI application (has an `evidence_url`, no uploaded file) |
| 6 | `priya.sharma@example.com` | `Password123!` | `contributor` | **pending** (`ADI22198`) | free | Pending ADI application, some reputation |
| 7 | `tom.briggs@example.com` | `Password123!` | `contributor` | **pending** (`ADI56712`) | free | Pending ADI application with **no evidence at all** |

### 3.1 Accounts you must create yourself

The seed data contains **no `moderator`**. Several documents in this pack require one.

**Create it** — sign in as `admin@routesync.uk`, open `/admin` → **Users**, find a user,
and set their role to `moderator` with the role dropdown. Use a throwaway account you
registered yourself, **not** one of the seeded accounts, or you will lose the ability to
re-run the tests that depend on that account's original role.

You will also want:

| Account | How to create | Needed for |
|---|---|---|
| A fresh learner with **no demo route claimed** | Register a new account through `/login` | `RTA-002`, `RTA-003` — the free-demo-route rule is one-shot per account |
| A `moderator` | Admin → Users → role dropdown | All `moderator` rows in [03-ACCESS-CONTROL-MATRIX.md](03-ACCESS-CONTROL-MATRIX.md), [roles/moderator.md](roles/moderator.md) |
| A **suspended** account | Admin → Users → **Suspend** | `AUTH-015`, `EDGE-015` |
| A learner with **Premium for one centre** | Complete a Stripe test checkout, or insert a `subscriptions` row directly (§6) | `RTA-005`, `RTA-006` |

---

## 4. Seeded content

### 4.1 Test centres

**~45 UK DVSA centres** across London, South East, Midlands, North, South West and East
of England, plus a demo set from [db/seed_test_centres_demo.sql](../db/seed_test_centres_demo.sql).

Useful fixed values:

| Centre | Town | Postcode | Note |
|---|---|---|---|
| **Mill Hill** | Mill Hill | `NW7 1RB` | Fixed id `33333333-3333-3333-3333-333333333333` — the anchor for most seeded routes |
| Isleworth | Isleworth | `TW7 4AG` | Has a published route and a flagged one |
| Hayes (Yeading) | Hayes | `UB4 0LT` | Has a published route |
| Wood Green | Wood Green | `N22 6SA` | Has a published route |
| Wanstead | Wanstead | `E11 2JT` | Has an in-review route |

### 4.2 Driving routes

| Route | Id (first block) | Status | Centre | Notes |
|---|---|---|---|---|
| Mill Hill test route | `22222222-…` | **published** | Mill Hill | `is_sample`, `is_instructor`, has front+rear video and markers |
| Isleworth town loop | `44444444-…` | **published** | Isleworth | front + rear video |
| Yeading residential & dual carriageway | `55555555-…` | **published** | Hayes (Yeading) | front + rear video |
| Wood Green busy junctions | `66666666-…` | **published** | Wood Green | `is_instructor` |
| Mill Hill evening route (pending) | `77777777-…` | **in_review** | Mill Hill | appears in the admin Review Queue |
| Instructor demo route (pending, fast-track) | `88888888-…` | **in_review** | Wanstead | `is_instructor` — sorts first in the queue |
| Isleworth night drive (flagged) | `99999999-…` | **flagged** | Isleworth | low quality (41) and low sync confidence (0.38) |

**All seeded videos point at a public HLS test stream**
(`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`), not at MinIO. Consequences:

- Playback works end-to-end without running the media worker.
- The video **is not** a driving route, and its duration (~60 s) will not match the map
  track. Do not raise "the video does not match the map" as a defect on seeded routes.
- Because the stream URL is absolute, playback **bypasses the signed HLS gateway**. To
  test the gateway (`PLAY-014` … `PLAY-016`) you need a route processed by the real
  worker. Marked `Needs Clarification` in [13-TESTING-GAPS.md](13-TESTING-GAPS.md).

### 4.3 Bookings data

From [db/seed_booking_test.sql](../db/seed_booking_test.sql):

- `instructor@routesync.uk` — "Sarah Johnson (ADI)", verified, 12 years, lesson price
  **£35.00**, accepting bookings, reputation 120.
- **7 availability slots** on `CURRENT_DATE + 1` through `+ 5`.
- One **confirmed** booking between `learner@routesync.uk` and that instructor on the
  first slot, with a `booking_payments` row.

> ⚠ **The seeded instructor has no `base_postcode` and no `base_location`.** Proximity
> search measures from that point, so a postcode search on `/instructors/find` will
> return this instructor in the **`elsewhere`** group, never `nearby`. That is the coded
> behaviour, not a bug. To test the `nearby` path, first set a base postcode via the
> instructor dashboard (`INST-004`).

### 4.4 Pending ADI applications

Three, all `pending`, visible in Admin → Instructors with a badge count of **3**:

| Applicant | ADI number | Evidence |
|---|---|---|
| James Carter | `ADI78341` | `evidence_url` only (an `example.com` link that will not resolve) |
| Priya Sharma | `ADI22198` | `evidence_url` only |
| Tom Briggs | `ADI56712` | **none** — use this one to test the "no uploaded badge photo" path |

None have an uploaded `evidence_key`, so **Admin → Instructors → View evidence returns
404** (`This application has no uploaded badge photo`) for all three. To test the signed
evidence link, submit a fresh application with a real photo (`IVER-006`).

### 4.5 Data the seed does **not** contain

Prepare these yourself before testing the relevant modules:

| Missing | Needed for | How to create |
|---|---|---|
| Any `moderator` user | All moderator tests | Admin → Users → role dropdown |
| Any suspended user | `AUTH-015`, `EDGE-015` | Admin → Users → Suspend |
| Any **reference route (R1)** | `REF-*`, `JRN-*`, and the upload wizard (which requires one) | Admin → Reference Routes → create |
| Any open **report** | `ADM-FIN-014` | No UI creates one — insert into `reports` directly, or mark as untestable |
| Any **fund transaction** or beneficiary | `ADM-FIN-006` … `ADM-FIN-011` | Admin → Community Fund → add beneficiary, then allocate/payout |
| Any **revshare run** | `ADM-FIN-012`, `ADM-FIN-013` | Admin → Instructor Earnings → **Run now** |
| Any **notification** row | `API-005` | No UI creates one — `Needs Clarification` |
| Any **offline package** | `API-002` … `API-004` | `POST /api/routes/:id/offline` via Swagger |
| Real dashcam footage + GPS logs | Full upload pipeline (`UPL-010`+) | Supply your own; see [docs/VIDEO_GPS_SYNC_GUIDE.md](../docs/VIDEO_GPS_SYNC_GUIDE.md) |

---

## 5. Configuration QA must check or request

Read from [apps/api/src/config/configuration.ts](../apps/api/src/config/configuration.ts).
**Ask the platform owner for values — do not put secrets in this folder.**

| Variable | Required? | If unset, what breaks |
|---|---|---|
| `DATABASE_URL` | **Yes** | API will not start |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | **Yes** | API will not start |
| `JWT_ACCESS_TTL` (default 900 s) | No | Shorten it to test token expiry quickly (`AUTH-021`) |
| `JWT_REFRESH_TTL` (default 30 days) | No | — |
| `REDIS_URL` | No (defaults to localhost) | Queueing / worker handoff |
| `API_BASE_URL` | Needed for HLS | Signed HLS gateway URLs are malformed |
| `APP_BASE_URL` | **Needed for email links** | Verification/reset links point at the wrong host |
| **`RESEND_API_KEY` + `MAIL_FROM`** | **Needed for `AUTH-029`…`AUTH-048`** | **No email is ever sent.** The API logs `Email not configured … dropped`. Because only the SHA-256 of the token is stored, the link is unrecoverable — these flows become **untestable** |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | Needed for checkout | `POST /api/subscriptions/checkout` fails; the paywall cannot complete |
| `STRIPE_WEBHOOK_SECRET` | Needed for entitlement | A completed checkout never grants Premium, because the webhook is what writes the subscription |
| `CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL` | Defaults to `localhost:5174/billing/*` | Stripe returns to the wrong place |
| `REVENUECAT_WEBHOOK_SECRET` | Mobile IAP only | **When unset the webhook's auth check is skipped entirely** — see `PERM-056` |
| `WORKER_SHARED_SECRET` | Needed for uploads | `POST /api/internal/journeys/analyse-upload` returns **503**; conformance is skipped and routes get flagged |
| S3/MinIO (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) | Needed for uploads | Presigned URLs fail; badge-evidence upload fails |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | Optional | Social sign-in endpoints return `… login not configured` |
| `VITE_MAP_PROVIDER`, `VITE_GOOGLE_MAPS_API_KEY` | Optional, **build-time** | Defaults to Leaflet/OpenStreetMap. `google` without a key silently falls back to Leaflet |
| `SENTRY_DSN` | Optional | No error reporting |

---

## 6. Direct database access (for setup and verification)

```bash
docker exec -it infra-postgres-1 psql -U routesync -d routesync
```

Queries QA will need repeatedly:

```sql
-- Who am I testing with?
SELECT email, role, is_suspended, email_verified FROM users ORDER BY created_at;

-- Has this learner already burned their one free route?
SELECT u.email, r.title FROM demo_route_claims d
  JOIN users u ON u.id = d.user_id JOIN routes r ON r.id = d.route_id;

-- Release the free-demo claim so the rule can be re-tested
DELETE FROM demo_route_claims WHERE user_id =
  (SELECT id FROM users WHERE email = 'learner@routesync.uk');

-- Grant Premium for ONE centre without going through Stripe
INSERT INTO subscriptions (id, user_id, plan, status, test_centre_id, current_period_end)
VALUES (gen_random_uuid(),
        (SELECT id FROM users WHERE email = 'learner@routesync.uk'),
        'premium_monthly', 'active',
        '33333333-3333-3333-3333-333333333333',   -- Mill Hill
        now() + interval '1 month');

-- Route statuses currently in the system
SELECT status, count(*) FROM routes WHERE deleted_at IS NULL GROUP BY status;

-- Booking + payment state
SELECT b.status, p.status AS payment_status, p.amount_minor, p.platform_fee_minor
  FROM bookings b LEFT JOIN booking_payments p ON p.booking_id = b.id;

-- Platform fee percentage actually in use
SELECT * FROM platform_config WHERE key = 'booking_fee_pct';
```

### Reset to a clean state

```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d
# then re-run step 2 of §2
```

Do this before any test run that depends on the free-demo-route rule, on upload quotas,
or on ADI applications being untouched.

---

## 7. External dependencies

| Service | Used by | If it is down / blocked |
|---|---|---|
| **postcodes.io** | Test-centre create/edit, instructor base postcode, instructor proximity search | Test-centre creation returns **503** with a clear message. Corporate networks often block this — check before raising a defect |
| **Stripe** | `/paywall` → checkout, `POST /api/webhooks/stripe` | Checkout cannot start |
| **Resend** | All transactional email | No verification or reset email |
| **Apple JWKS** (`appleid.apple.com`) | Apple sign-in | Apple sign-in fails |
| **mux.dev test stream** | Seeded route video | Seeded routes will not play |
| **OpenStreetMap tiles** | Every map (Leaflet default) | Maps render blank/grey |

---

## 8. Browser and device matrix

The application declares no supported-browser list. `Needs Clarification` — confirm with
the product owner. In the absence of one, the code's constraints suggest:

| Requirement | Why |
|---|---|
| A modern evergreen browser (Chrome, Edge, Firefox, Safari) | ES modules, `hls.js`, `AbortSignal.timeout` |
| **Geolocation permission** | `/contribute/record` cannot work without it |
| **Speech synthesis** | Practice mode speaks instructions in `en-GB` |
| `localStorage` enabled | Sessions are stored there — a browser blocking it cannot stay signed in |
| A viewport **narrower than 700 px** (or DevTools emulation) | The bottom tab bar only exists below 700 px; above it, the desktop header nav is used instead ([index.css](../apps/web/src/index.css)) |
</content>
