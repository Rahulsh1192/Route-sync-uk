# Test Routify — Tour Guide (What Changed & How It Works Now)

> A guided tour of the platform after the **Phase 20** changes (rebrand + Test
> Centres + simplified access) and the **admin merge**. Three lenses:
> **1) the UI**, **2) how it works for a user**, **3) the code architecture**.
> File references are clickable.

---

## TL;DR — the headline changes

1. **Rebranded** RouteSync → **Test Routify** (new name, logo, branded landing page).
2. **Test Centres** are now a first-class, browsable section — and the default home after sign-in.
3. **The old "enter your test centre + date" gate is gone.** Everyone browses freely; you pay per test centre, with one free demo route.
4. **Distances are in miles**, route cards show the **instructor** (avatar + name + verified badge).
5. **One global search** replaced the old search page + sidebar filters.
6. **The admin app is no longer separate** — it lives inside the web app at **`/admin`**, and admins land there automatically on login.

---

# 1) The UI — what looks/feels different

| Area | Before | Now |
|---|---|---|
| **Brand** | "RouteSync" | **"Test Routify"** wordmark + new logo ([icon.svg](apps/web/public/icon.svg)) |
| **Entry screen** | Plain login box | **Branded landing page** — hero, logo, tagline, feature points ([LoginPage.tsx](apps/web/src/pages/LoginPage.tsx)) |
| **Top nav / tabs** | Discover · Search · Instructors · Bookings · Contribute · Account | **Test Centres · Discover Routes · My Bookings · Contribute · Account** ([Layout.tsx](apps/web/src/components/Layout.tsx)) |
| **Search** | Header search + a separate Search page with sidebar filters (postcode/centre/town) | **One global search box** on the route list, matching title / instructor / centre / town / postcode ([DiscoverPage.tsx](apps/web/src/pages/DiscoverPage.tsx)) |
| **Test Centres** | Not browsable | **New section**: list with search + route counts, detail page with its routes, and create/edit/delete for staff |
| **Route card** | `📏 km` · `⏱ time` · `🔄 roundabouts` · quality | **`📏 miles`** + **instructor byline** (avatar, name, ✓ verified) + quality; time & roundabout removed ([RouteCard.tsx](apps/web/src/components/RouteCard.tsx)) |
| **Instructor** | Standalone "Instructors" browse tab | Tab removed; instructors surface **through routes** → click the byline to open their **profile** (routes created + centres covered) ([InstructorProfilePage.tsx](apps/web/src/pages/InstructorProfilePage.tsx)) |
| **Admin** | Separate app on `http://localhost:5180` | **`/admin` inside the web app** — admins land here on login ([AdminApp.tsx](apps/web/src/admin/AdminApp.tsx)) |

New screens: [TestCentresPage.tsx](apps/web/src/pages/TestCentresPage.tsx) · [TestCentreDetailPage.tsx](apps/web/src/pages/TestCentreDetailPage.tsx) · [TestCentreFormPage.tsx](apps/web/src/pages/TestCentreFormPage.tsx) · [InstructorByline.tsx](apps/web/src/components/InstructorByline.tsx)

---

# 2) How it works now — the user's point of view

### Everyone signs in first
There's no anonymous mode. On sign-in you're routed **by role**:

- **Learner / instructor →** the **Test Centres** page (`/test-centres`).
- **Admin / moderator →** the **Admin console** (`/admin`).

### The learner journey (browse → watch → pay)
1. **Browse Test Centres** — search by name/town/postcode; each card shows how many routes it has.
2. **Open a centre** — see its details (address, description) and all its routes.
3. **Open a route** — watch the GPS-synced drive or practise it as turn-by-turn voice guidance.
4. **Access rules (no gate anymore):**
   - The **first route you open is free** — your one demo route, account-wide.
   - Any **other** route → the **paywall for that test centre**.
   - **Premium is per test centre** and unlocks *all* routes at that centre (not switchable).
5. **Global search** (on Discover) finds routes across title, instructor, centre, town or postcode.
6. **Booking an instructor** needs **no Premium**.

### The instructor
- Everything a learner can do, **plus**: create/edit/delete **test centres** and **upload routes** (each upload must be attached to a test centre).
- Their identity shows on every route they made (avatar + name + ✓), and their **profile** lists their routes and the centres they cover.

### The admin / moderator
- Lands directly on the **Admin console** (`/admin`): review queue, users, instructor verification, revenue, community fund, reports, bookings.
- Can also manage test centres / routes via the main app (the "Main app" link in the admin sidebar switches over).

### Who can do what
| Capability | Learner | Instructor | Admin/Moderator |
|---|:--:|:--:|:--:|
| Browse centres & routes, search | ✅ | ✅ | ✅ |
| Watch/practise (demo + per-centre Premium) | ✅ | ✅ | ✅ |
| Create/edit/delete **test centres** | — | ✅ | ✅ |
| **Upload routes** | — | ✅ | ✅ |
| **Admin console** (`/admin`) | — | — | ✅ |

---

# 3) The code architecture — how it's built now

## Monorepo shape (unchanged top level)
```
apps/
  api/      NestJS + Prisma (Postgres/PostGIS) — the backend
  web/      React + Vite — the single front-end (learner UI + /admin console)
  mobile/   Flutter — rebranded (feature parity is a follow-up)
services/worker/   Python media/AI processing
db/         SQL schema, migrations, seeds
infra/      docker-compose, nginx
```
> `apps/admin` was **removed** — the admin console now lives inside `apps/web`.

## Front-end (apps/web)

**Routing & role-based landing** — [App.tsx](apps/web/src/App.tsx)
- `RoleLanding` reads the signed-in user's role and redirects (`admin`/`moderator` → `/admin`, else `/test-centres`).
- `Protected` wraps **learner** pages in the shared [Layout.tsx](apps/web/src/components/Layout.tsx) (top/bottom nav).
- `AdminProtected` renders the **admin console without** the learner shell and bounces non-admins.
- The admin console is **code-split** (`lazy(() => import('./admin/AdminApp'))`) so its JS/CSS is only fetched for admins — the learner bundle stays lean.

**Auth** — [AuthContext.tsx](apps/web/src/auth/AuthContext.tsx)
- On login it stores tokens and fetches `GET /users/me` to expose `user` (incl. `role`) and an `isStaff` helper used to gate UI.

**API client** — [client.ts](apps/web/src/api/client.ts)
- One `request()` with bearer token + auto-refresh.
- New methods: `meUser`, `listTestCentres`, `testCentre`, `createTestCentre`, `updateTestCentre`, `deleteTestCentre`, `instructorRoutes`; `searchRoutes` is now a single global query term.
- Types live in [types.ts](apps/web/src/api/types.ts); `distanceLabel` now formats **miles**.

**Admin console** — [apps/web/src/admin/](apps/web/src/admin/)
- `AdminApp.tsx` + `panels/*` moved from the old app.
- `admin/api.ts` **delegates to the shared web client** (`api.request`) — one login/token for the whole app, no separate admin token.
- **CSS isolation:** the old admin stylesheet is auto-scoped under a `.admin-app` wrapper in [admin.css](apps/web/src/admin/admin.css) (its `:root` tokens and element selectors are rewritten so they can't leak into the learner UI). The admin console and learner UI never render on the same page, so scoping is fully safe.

## Back-end (apps/api)

**Test Centres module (new)** — [modules/test-centres/](apps/api/src/modules/test-centres/)
- `GET /test-centres`, `GET /test-centres/:id` are public reads; `POST/PATCH/DELETE` require `@Roles('instructor','admin')` (via `JwtAuthGuard` + `RolesGuard`).
- Uses **raw SQL + PostGIS** (`ST_MakePoint`, `ST_X/ST_Y`) because the location is a geography column.
- **Geocoding:** the postcode is resolved to lat/lng via **postcodes.io** (free, no key) on create/edit.
- The route count is cast to `int` in SQL — a raw `COUNT()` bigint otherwise breaks JSON serialisation.

**Access model** — [routes.service.ts](apps/api/src/modules/routes/routes.service.ts)
- `resolveAccess()` no longer has a `TEST_DETAILS_REQUIRED` branch. It returns `ok` | `PAYWALL`:
  - Premium for the route's centre → `ok`.
  - Else the account's one `DemoRouteClaim` (first route opened) → `ok` for that route.
  - Else → `PAYWALL`.
- `withInstructor()` flattens the route's contributor into `instructorId/Name/Avatar/Verified`.
- `GET /routes/by-instructor/:id` returns an instructor's routes + the distinct centres they cover.

**Search** — [search.service.ts](apps/api/src/modules/search/search.service.ts): `routes(q)` matches one term across title / instructor / centre / town / postcode.

**Uploads** — [uploads.dto.ts](apps/api/src/modules/uploads/dto/uploads.dto.ts) now **requires** `testCentreId`; [uploads.controller.ts](apps/api/src/modules/uploads/uploads.controller.ts) restricts uploads to `instructor`/`admin`.

> **Security note:** client-side role gating is convenience only. Every admin/write endpoint is still enforced **server-side** by `RolesGuard`, so merging the admin UI into the web bundle is not a security downgrade.

## Database — [db/](db/)
- `test_centres` gained `address` + `description`; new index on `routes.test_centre_id`.
- Migration: [migrate_phase_20.sql](db/migrate_phase_20.sql) (idempotent). Demo content: [seed_test_centres_demo.sql](db/seed_test_centres_demo.sql).
- `schema.sql` and `bootstrap.sql` updated to match.
- **Deploy note:** run `migrate_phase_20.sql` on the deployed Supabase DB (once) or the `/api/test-centres` endpoint 500s.

## Deployment
- **One front-end** now (the web app; admin is a lazy chunk inside it). The root [Dockerfile](Dockerfile), [nginx config](infra/nginx/frontends.conf), [docker-compose.yml](docker-compose.yml) and the CI matrix were reduced from two frontends to one (port 5180 removed).
- API deploys via [render.yaml](render.yaml); frontend via Vercel/static.

---

## Quick file map (where to look)

| Want to change… | Go to |
|---|---|
| Brand/logo/landing | [LoginPage.tsx](apps/web/src/pages/LoginPage.tsx), [icon.svg](apps/web/public/icon.svg) |
| Nav / tabs | [Layout.tsx](apps/web/src/components/Layout.tsx) |
| Routing / role landing | [App.tsx](apps/web/src/App.tsx) |
| Test Centres UI | [TestCentresPage.tsx](apps/web/src/pages/TestCentresPage.tsx), [TestCentreDetailPage.tsx](apps/web/src/pages/TestCentreDetailPage.tsx), [TestCentreFormPage.tsx](apps/web/src/pages/TestCentreFormPage.tsx) |
| Test Centres API + geocoding | [test-centres.service.ts](apps/api/src/modules/test-centres/test-centres.service.ts) |
| Access / paywall / demo rules | [routes.service.ts](apps/api/src/modules/routes/routes.service.ts) |
| Route card / instructor byline | [RouteCard.tsx](apps/web/src/components/RouteCard.tsx), [InstructorByline.tsx](apps/web/src/components/InstructorByline.tsx) |
| Admin console | [apps/web/src/admin/](apps/web/src/admin/) |
| DB changes | [db/migrate_phase_20.sql](db/migrate_phase_20.sql) |

_For run/deploy steps see [RUNNING_LOCALLY.md](docs/RUNNING_LOCALLY.md) and [DEPLOY_STEP_BY_STEP.md](docs/DEPLOY_STEP_BY_STEP.md)._
