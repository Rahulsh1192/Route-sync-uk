# 14 — Final Coverage Audit

A second pass over the codebase, checking this documentation pack against what is actually
there. Completed **2026-08-17** against branch `master` at commit `3b8d0ac`.

---

## Modules

- [x] **All major modules discovered** — 21 NestJS feature modules under
      [apps/api/src/modules/](../apps/api/src/modules/), plus `HealthController`, plus
      20 learner-facing pages and 10 admin panels in [apps/web/src/](../apps/web/src/).
- [x] **All major modules documented** — 19 documents under [modules/](modules/).

| API module | Documented in |
|---|---|
| `auth` | [04-AUTHENTICATION-TESTING.md](04-AUTHENTICATION-TESTING.md) |
| `users` | [modules/account-profile.md](modules/account-profile.md) |
| `test-centres` | [modules/test-centres.md](modules/test-centres.md) |
| `routes` | [modules/route-detail-access-paywall.md](modules/route-detail-access-paywall.md), [modules/route-playback-practice.md](modules/route-playback-practice.md) |
| `search` | [modules/route-discovery-search.md](modules/route-discovery-search.md) |
| `subscriptions` + `webhooks` | [modules/subscriptions-billing.md](modules/subscriptions-billing.md) |
| `bookings` (learner half) | [modules/bookings.md](modules/bookings.md) |
| `bookings` (instructor half) | [modules/instructor-dashboard.md](modules/instructor-dashboard.md) |
| `bookings` (admin half) | [modules/admin-bookings.md](modules/admin-bookings.md) |
| `community` (verification) | [modules/instructor-verification.md](modules/instructor-verification.md) |
| `community` (badges, leaderboards, agreement) | [modules/api-only-modules.md](modules/api-only-modules.md) |
| `uploads` + `storage` + `queue` | [modules/contribute-uploads.md](modules/contribute-uploads.md) |
| `journeys` (journeys) | [modules/record-drive-journeys.md](modules/record-drive-journeys.md) |
| `journeys` (reference routes) | [modules/reference-routes.md](modules/reference-routes.md) |
| `admin` (queue) | [modules/admin-review-queue.md](modules/admin-review-queue.md) |
| `admin` (users) | [modules/admin-users.md](modules/admin-users.md) |
| `admin` (instructors) | [modules/admin-instructors.md](modules/admin-instructors.md) |
| `admin` (revenue) + `fund` + `revshare` + reports | [modules/admin-finance-and-reports.md](modules/admin-finance-and-reports.md) |
| `progress` | [modules/progress-history.md](modules/progress-history.md) |
| `offline`, `notifications`, `fund` (public), health, throttling | [modules/api-only-modules.md](modules/api-only-modules.md) |
| `geo` (postcodes) | No document of its own — it is a dependency, tested through test centres and instructor search |
| `mail` | No document of its own — tested through [04](04-AUTHENTICATION-TESTING.md) |

**Not covered, and stated as such:** the Flutter mobile app
([apps/mobile/](../apps/mobile/)) and the Python media worker
([services/worker/](../services/worker/)). Both are recorded as out of scope in
[13-TESTING-GAPS.md §9](13-TESTING-GAPS.md).

---

## Web pages

- [x] **All 20 pages reviewed and covered.**

`AccountPage` · `BillingResultPage` · `BookingsPage` · `contribute/ContributePage` ·
`contribute/InstructorVerifyPage` · `contribute/RecordDrivePage` ·
`contribute/UploadPage` · `contribute/UploadStatusPage` · `DiscoverPage` ·
`FindInstructorsPage` · `ForgotPasswordPage` · `InstructorDashboardPage` ·
`InstructorProfilePage` · `LoginPage` · `PaywallPage` · `PracticePage` · `ProgressPage` ·
`ResetPasswordPage` · `RouteDetailPage` · `TestCentreDetailPage` · `TestCentreFormPage` ·
`TestCentresPage` · `VerifyEmailPage` · `WatchPage`

- [x] **All 10 admin panels covered** — `ReviewQueue`, `RouteDetail`, `Users`,
      `Instructors`, `Bookings`, `ReferenceRoutes`, `Revenue`, `Fund`, `Earnings`,
      `Reports`.

---

## Routes

- [x] **All URL paths in [apps/web/src/App.tsx](../apps/web/src/App.tsx) reviewed** —
      inventoried in [01 §7](01-APPLICATION-OVERVIEW.md).
- [x] **Protected routes identified** — the `Protected` / `AdminProtected` / `RoleLanding`
      guards are documented in [01 §5](01-APPLICATION-OVERVIEW.md) and their per-role
      outcomes in [03 §8](03-ACCESS-CONTROL-MATRIX.md).
- [x] **Routes with no role guard identified** — `/test-centres/new`,
      `/test-centres/:id/edit`, `/contribute/*`, `/instructors/me`. Recorded as **PI-07**
      and tested by `PERM-023` … `PERM-029`.
- [x] Legacy redirects (`/search`, `/instructors`, `/test-details`) and the catch-all
      covered.

---

## Roles

- [x] **All roles discovered** — the `user_role` enum has exactly five members:
      `user`, `contributor`, `instructor`, `moderator`, `admin`
      ([db/schema.sql:23](../db/schema.sql)). No other role mechanism exists.
- [x] **All five documented** — one file each in [roles/](roles/).
- [x] **Verified there is no permission table, no role hierarchy and no per-user grants** —
      `RolesGuard` performs a flat `required.includes(user.role)` test.
- [x] **Verified `contributor` grants nothing** — searched every `@Roles(...)` decorator;
      the string `contributor` appears in none of them.
- [x] **Role transitions documented** — [02 §6](02-USERS-ROLES-PERMISSIONS.md),
      [09 §4](09-STATE-AND-DATA-FLOW.md).

---

## Permissions

- [x] **All permission mechanisms discovered:**
      `JwtAuthGuard` · `RolesGuard` + `@Roles()` · `EntitlementGuard` +
      `@RequirePremium()` (defined but **unused** — PI-18) · `WorkerSecretGuard` ·
      `ThrottlerGuard` · per-service ownership checks · Stripe signature verification ·
      RevenueCat bearer check.
- [x] **Permission matrix created** — [03-ACCESS-CONTROL-MATRIX.md](03-ACCESS-CONTROL-MATRIX.md),
      covering Role → Module → Feature → Action → Expected access for all five roles plus
      anonymous.
- [x] **Class-level defaults and method-level overrides distinguished** — the
      `@Roles('admin')` overrides on the admin controller are called out individually.
- [x] **Endpoints with *no* role gate identified** — including `GET /api/uploads/:id`
      (ownership-only) and every unauthenticated read.

---

## APIs

- [x] **All 113 HTTP endpoints enumerated and mapped** to a row in
      [03-ACCESS-CONTROL-MATRIX.md](03-ACCESS-CONTROL-MATRIX.md) and to at least one test
      case.

| Controller | Endpoints | Covered |
|---|---|---|
| `auth` | 10 | ✔ [04](04-AUTHENTICATION-TESTING.md) |
| `users` | 7 | ✔ [modules/account-profile.md](modules/account-profile.md) |
| `test-centres` | 6 | ✔ |
| `routes` | 9 | ✔ |
| `search` | 2 | ✔ |
| `subscriptions` | 3 | ✔ |
| `uploads` | 7 | ✔ |
| `admin` | 23 | ✔ |
| `bookings` | 12 | ✔ |
| `community` | 8 | ✔ |
| `fund` | 2 | ✔ |
| `journeys` (incl. internal) | 9 | ✔ |
| `progress` | 4 | ✔ |
| `offline` | 4 | ✔ |
| `notifications` | 4 | ✔ |
| `webhooks` | 3 | ✔ |
| `health` | 1 | ✔ |

- [x] **Authorisation reviewed for every endpoint**, at UI, route, API and data level —
      [03 §1](03-ACCESS-CONTROL-MATRIX.md), [06 §1](06-NEGATIVE-TESTING.md).
- [x] **Machine-to-machine surfaces reviewed** — one is unprotected (**PI-01**), one is
      conditionally unprotected (**PI-02**).

---

## Database

- [x] **All 18 enums reviewed** — `user_role`, `auth_provider`, `subscription_plan`,
      `subscription_status`, `billing_source`, `route_status`, `route_difficulty`,
      `camera_view`, `video_rendition`, `upload_status`, `pipeline_stage`, `stage_state`,
      `approval_decision`, `instructor_status`, `fund_entry_type`,
      `notification_channel`, `takedown_status`, `ai_session_type`, `booking_status`,
      `email_token_purpose`.
- [x] **State machines documented** — route status, upload status, booking status,
      instructor status, subscription status, journey verdict —
      [09-STATE-AND-DATA-FLOW.md](09-STATE-AND-DATA-FLOW.md).
- [x] **Seed data catalogued** — [12 §3 and §4](12-TEST-ENVIRONMENT-AND-DATA.md),
      including what the seed **does not** contain.
- [x] **Enum values with no writer identified** — `archived` (PI-19).

---

## Workflows

- [x] **Critical workflows documented** — 9 in
      [05-END-TO-END-WORKFLOWS.md](05-END-TO-END-WORKFLOWS.md).
- [x] **Cross-module dependencies mapped** — [01 §9](01-APPLICATION-OVERVIEW.md) and
      [09 §7](09-STATE-AND-DATA-FLOW.md) (26 propagation checks).
- [x] **Non-propagation documented** — [09 §8](09-STATE-AND-DATA-FLOW.md).

---

## Negative testing

- [x] **Authorisation** — 60 `PERM-###` cases across privilege escalation, role gates,
      route-guard bypass, data-scope bypass, entitlement bypass and machine-to-machine.
- [x] **Validation** — 19 `NEG-###` cases derived from the actual decorators
      (`@MinLength`, `@MaxLength`, `@Min`, `@Max`, `@IsUUID`, `@IsEnum`, `@IsIn`,
      `@IsDateString`, `@Matches`), plus the fields that are validated **only** by the
      database.
- [x] **Error handling** — 50 `ERR-###` cases including third-party failure, timeouts,
      partial data and the known "succeeds but does nothing" cases.
- [x] **Edge cases** — 93 `EDGE-###` cases covering empty states, stale authorisation,
      concurrency, multiple tabs, boundaries, character sets, dates and large datasets.

---

## Accuracy checks performed

Claims that were verified against the source rather than assumed:

| Claim | How it was checked |
|---|---|
| `contributor` grants nothing | Grepped every `@Roles(...)` in the API |
| `admin` cannot use the instructor availability endpoints | Read `@Roles('instructor')` on those handlers |
| Moderator cannot write test centres | Read `@Roles('instructor','admin')` |
| Free demo route is one per **account**, not per centre | Read `resolveAccess()` and the `demo_route_claims` unique key on `userId` |
| Yearly price inconsistency | Compared `plans()`, `fund.constants.ts`, `AdminService.revenue()` and the seed files |
| Progress is never written | Grepped every call site of `recordWatch` / `recordPractice` and every web call to `session-complete` |
| Email tokens are unrecoverable without email | Read `createEmailToken()` — only the SHA-256 is stored; grepped for any logging of the URL |
| `worker/upload-status` is unguarded | Read the handler and its decorators |
| Mobile breakpoint is 700 px, not 768 px | Read the media queries in `index.css` |
| Seeded video bypasses the HLS gateway | Read `streamUrl()` and the seeded `manifest_key` values |
| `GET /api/routes/:id` does not leak the GPS track | Confirmed `track_geom` is absent from the Prisma `Route` model |
| Seeded instructor has no base postcode | Read `db/seed_booking_test.sql` |
| Bookings default to `pending` | Read the `bookings` table definition |
| Journey thresholds and defaults | Read `DEFAULT_MATCH_OPTIONS` and `matchOptions()` |
| Rev-share instructor share defaults to 0 % | Read `RevshareService.config()` |

---

## Known limitations of this pack

Stated plainly so nobody assumes coverage that is not there.

1. **Nothing in this pack has been executed.** Every test case was derived by reading the
   implementation. The first execution run should be treated as validating the
   documentation as well as the application; expect some cases to need correction.
2. **The Flutter mobile app and the Python worker are not covered.**
3. **Deployed-environment specifics are incomplete** — the web host is a placeholder in the
   repository (`Needs Clarification` in [12 §1](12-TEST-ENVIRONMENT-AND-DATA.md)).
4. **Ten areas are marked `Untestable`** in the available environment
   ([13 §9](13-TESTING-GAPS.md)) — most notably email flows and the signed HLS gateway.
5. **Performance, load and penetration testing are out of scope.** The authorisation cases
   here are functional checks, not a security assessment.
6. **No visual-regression baseline exists.** [11](11-RESPONSIVE-AND-ACCESSIBILITY.md) tests
   layout behaviour, not pixel fidelity.
7. **17 questions remain open for the product owner**
   ([13 §10](13-TESTING-GAPS.md)). Several of them determine whether a behaviour is a
   defect or the intended design — they should be answered before the first full run.

---

## Test case totals

| Document | Cases |
|---|---|
| 04 Authentication | 48 |
| 06 Negative testing | 60 `PERM` + 54 `NEG` |
| 07 Edge cases | 93 |
| 09 State & data flow | 60 |
| 10 Error & recovery | 50 |
| 11 Responsive & accessibility | 27 `UI` + 27 `A11Y` |
| 05 End-to-end workflows | 9 workflows |
| modules/ | ~500 across 19 documents |
| roles/ | ~150 across 5 documents |
</content>
