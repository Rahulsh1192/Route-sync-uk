# Module — API-Only Modules (No Web UI)

**Prefix:** `API-###`

These modules are fully implemented in the API but have **no page in the web app**. Test
them through Swagger (`http://localhost:3000/docs`), curl or Postman with a bearer token.

Their absence from the UI is a **product gap**, not a defect — recorded once in
[13-TESTING-GAPS.md](../13-TESTING-GAPS.md).

---

## 1. Offline packages

| | |
|---|---|
| **Purpose** | Download a route for offline use on a device |
| **API** | `POST /api/routes/:id/offline` · `GET /api/routes/:id/offline` · `DELETE /api/routes/:id/offline` · `GET /api/users/me/offline` |
| **Roles** | Any authenticated user — but **Premium is required** |
| **Backend** | [offline.service.ts](../../apps/api/src/modules/offline/offline.service.ts) |
| **Dependencies** | Redis/BullMQ (a `build` job assembles the package) · object storage |

**Business rules:** requesting a package requires `isPremium()` — the **universal** check,
not the per-centre one, so a centre-scoped subscription still satisfies it. An existing,
unexpired package is returned immediately with a presigned URL; otherwise a build job is
queued. Revoking sets `expires_at` to one second ago. Every query is scoped to the caller.

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| API-001 | **Free user is refused** | user | Free plan | `POST /api/routes/<id>/offline` | **403 Premium subscription required for offline access** |
| API-002 | Premium user queues a package | admin | Universal premium | `POST /api/routes/<id>/offline` with `{"deviceId":"qa-1"}` | A job is queued and a pending status returned |
| API-003 | Fetch a package URL before it is built | admin | API-002 just run | `GET /api/routes/<id>/offline` | **404 No offline package found — request one first** until the worker finishes |
| API-004 | List own packages | admin | — | `GET /api/users/me/offline` | Only the caller's non-expired packages |
| API-005 | Revoke a package | admin | A package exists | `DELETE /api/routes/<id>/offline` | The package stops being returned by the list and the URL endpoint |
| API-006 | Non-existent route | admin | — | `POST /api/routes/00000000-0000-0000-0000-000000000000/offline` | **404 Route not found** |
| API-007 | **Data scope** | admin | Two users each with a package | `GET /api/users/me/offline` as user A | Only A's packages |
| API-008 | Unauthenticated | — | No token | `GET /api/users/me/offline` | **401** |

---

## 2. Notifications

| | |
|---|---|
| **Purpose** | In-app / push notifications and device-token registration |
| **API** | `POST /api/notifications/register` · `DELETE /api/notifications/register/:token` · `GET /api/notifications` · `PATCH /api/notifications/:id/read` |
| **Roles** | Any authenticated user |
| **Backend** | [notifications.service.ts](../../apps/api/src/modules/notifications/notifications.service.ts) |

**Business rules:** the service exposes `notifyBookingConfirmed`, `notifyBookingCancelled`
and `notifyNewBookingRequest`, but **check whether the booking flow actually calls them** —
`API-012` covers this. `getNotifications` and `markRead` are scoped to the caller.

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| API-009 | Register a device token | user | — | `POST /api/notifications/register` with `{"platform":"ios","token":"qa-token-1"}` | A `device_tokens` row is created |
| API-010 | List notifications | user | — | `GET /api/notifications` | The caller's notifications, or an empty list — never a 404 |
| API-011 | Mark as read | user | A notification exists | `PATCH /api/notifications/<id>/read` | It is marked read |
| API-012 | **Does booking generate a notification?** | user | Create a booking (`BOOK-018`) | `GET /api/notifications` as both the learner and the instructor | Record the result. If nothing is generated, that is a **gap** — the notify helpers exist but may not be called anywhere |
| API-013 | **Unregister any device token** | user | Know **another user's** device token string | `DELETE /api/notifications/register/<their token>` | The handler takes the token from the URL and **does not scope it to the caller**. If this succeeds, it is a real authorisation defect — raise it as `PERM-045` / **PI-03** |
| API-014 | Mark someone else's notification read | user | Another user's notification id | `PATCH /api/notifications/<their id>/read` | Should have no effect — the query is scoped by user id. Confirm |
| API-015 | Unauthenticated | — | No token | `GET /api/notifications` | **401** |

---

## 3. Community: badges, leaderboards, contributor profiles

| | |
|---|---|
| **Purpose** | Contributor credits, reputation, badges and leaderboards |
| **API** | `GET /api/badges` · `GET /api/leaderboards?period=` · `GET /api/contributors/:id` · `GET /api/contributors/me/profile` · `POST /api/contributors/agreement` |
| **Roles** | The first three are **unauthenticated**; the last two require a session |
| **Backend** | [community.service.ts](../../apps/api/src/modules/community/community.service.ts) · [community.constants.ts](../../apps/api/src/modules/community/community.constants.ts) |

**Business rules:** `CREDITS_PER_ROUTE` = **10**, plus a high-quality bonus when the
route's quality clears the threshold. The agreement version is **`2026-01`** and
accepting it is idempotent (`ON CONFLICT DO NOTHING`). Leaderboards are **materialised by
a daily 3 a.m. cron**, so a fresh contribution does not appear immediately.
Contributor stats *are* surfaced in the UI — on `/contribute` (Credits / Reputation /
Published) — but badges and leaderboards have **no page**.

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| API-016 | Badge catalogue | — | No token | `GET /api/badges` | **200** with the badge definitions. Confirm the endpoint is intentionally public |
| API-017 | Leaderboard | — | No token | `GET /api/leaderboards?period=alltime` | **200**. It may be empty until the daily cron has run — that is expected, not a defect |
| API-018 | Contributor profile | — | No token | `GET /api/contributors/<userId>` | **200** with credits, reputation, routes published and badges. **Check what personal data is included** — this endpoint is public |
| API-019 | Non-existent contributor | — | — | `GET /api/contributors/00000000-0000-0000-0000-000000000000` | **404 Contributor not found** |
| API-020 | Own contributor profile | user | — | `GET /api/contributors/me/profile` | The caller's own stats |
| API-021 | Accept the footage agreement | user | — | `POST /api/contributors/agreement` | `{version:"2026-01", accepted:true}`; a `contributor_agreements` row with the request IP |
| API-022 | Accepting twice is idempotent | user | API-021 done | Call it again | Same response; **no duplicate row** |
| API-023 | Credits are awarded on publish | admin + contributor | Note a contributor's credits, then approve one of their routes (`ADM-RQ-011`) | `GET /api/contributors/<id>` | Credits increased by **10** (plus any high-quality bonus); `routes_published` incremented |
| API-024 | Leaderboard refresh | — | API-023 done | Check the leaderboard immediately, then after the 3 a.m. cron (or trigger it manually) | Immediately unchanged; refreshed after the cron |

---

## 4. Public fund transparency

Covered by `ADM-FIN-015` in [admin-finance-and-reports.md](admin-finance-and-reports.md).
`GET /api/fund/summary` and `GET /api/fund/reports?year=` are **deliberately public**.

---

## 5. Health

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| API-025 | Health check | — | No token | `GET /api/health` | **200** `{status:"ok", db:"up", time:…}` |
| API-026 | Health with the database down | — | Stop the Postgres container | `GET /api/health` | **200** with `db: "down"` — the endpoint itself must not fail |

---

## 6. Rate limiting (global)

The global throttle is **120 requests per minute per IP**
([app.module.ts](../../apps/api/src/app.module.ts)).

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| API-027 | **Global throttle** | any | — | Send 130 requests to `GET /api/health` within a minute from one IP | Later requests return **429 Too Many Requests** |
| API-028 | Throttle does not break normal use | user | — | Click around the app normally for a minute | No 429. If ordinary use trips the limit, that is a defect worth raising |

---

## Traceability

| Test IDs | API | Guard | Logic |
|---|---|---|---|
| API-001 … API-008 | `/api/routes/:id/offline`, `/api/users/me/offline` | `JwtAuthGuard` + `isPremium()` | `OfflineService` |
| API-009 … API-015 | `/api/notifications/*` | `JwtAuthGuard` | `NotificationsService` |
| API-016 … API-024 | `/api/badges`, `/api/leaderboards`, `/api/contributors/*` | mixed | `CommunityService` |
| API-025, API-026 | `/api/health` | none | `HealthController` |
| API-027, API-028 | all | `ThrottlerGuard` | `ThrottlerModule.forRoot([{ttl:60000, limit:120}])` |
</content>
