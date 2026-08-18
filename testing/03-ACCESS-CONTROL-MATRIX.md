# 03 — Access Control Matrix

Built by reading every controller in [apps/api/src/modules/](../apps/api/src/modules/)
and the route guards in [apps/web/src/App.tsx](../apps/web/src/App.tsx).

**Legend**

| Symbol | Meaning |
|---|---|
| ✅ | Allowed — the role appears in the endpoint's `@Roles(...)`, or the endpoint has no role requirement |
| ❌ | Denied — expect **403 Forbidden** with `Insufficient role` |
| 🔒 | Allowed only for **the caller's own** records (ownership enforced in the service) |
| 💳 | Allowed only with a satisfied entitlement (Premium for that centre, or the claimed demo route) — otherwise **403** `Premium subscription required for this test centre` |
| 🌐 | **No authentication required at all** — reachable without any token |

---

## 1. How to test each cell

For every ❌ cell, run all four levels:

| Level | Method | Pass criteria |
|---|---|---|
| **UI** | Sign in as the role; look for the control | The control is absent or disabled |
| **Route** | Type the URL path directly into the address bar | Redirected, or shown an error — never the page |
| **API** | Call the endpoint with that role's bearer token (Swagger at `/docs`, curl, or Postman) | **403**, not 200 |
| **Data** | Call an endpoint that returns a list | Only rows the caller owns are returned |

A ❌ that passes at UI level but returns **200** at API level is a **high-severity
defect**. See [06-NEGATIVE-TESTING.md](06-NEGATIVE-TESTING.md).

---

## 2. Authentication module

| Module | Feature | Action | Method + endpoint | anon | user | contributor | instructor | moderator | admin |
|---|---|---|---|---|---|---|---|---|---|
| Auth | Registration | Create | `POST /api/auth/register` | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 |
| Auth | Login | Execute | `POST /api/auth/login` | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 |
| Auth | Google sign-in | Execute | `POST /api/auth/oauth/google` | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 |
| Auth | Apple sign-in | Execute | `POST /api/auth/oauth/apple` | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 |
| Auth | Token refresh | Execute | `POST /api/auth/refresh` | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 |
| Auth | Logout | Execute | `POST /api/auth/logout` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Auth | Resend verification | Execute | `POST /api/auth/verify-email/resend` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Auth | Verify email | Execute | `POST /api/auth/verify-email` | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 |
| Auth | Request reset | Execute | `POST /api/auth/forgot-password` | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 |
| Auth | Reset password | Execute | `POST /api/auth/reset-password` | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 | 🌐 |

---

## 3. Learner-facing modules

| Module | Feature | Action | Method + endpoint | anon | user | contributor | instructor | moderator | admin |
|---|---|---|---|---|---|---|---|---|---|
| Test Centres | Centre list / search | View | `GET /api/test-centres?q=` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Test Centres | Centre detail + its routes | View | `GET /api/test-centres/:id` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Test Centres | Postcode lookup helper | Execute | `GET /api/test-centres/lookup/postcode` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Test Centres | Centre | Create | `POST /api/test-centres` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Test Centres | Centre | Edit | `PATCH /api/test-centres/:id` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Test Centres | Centre | Delete | `DELETE /api/test-centres/:id` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Discovery | Published route list | View | `GET /api/routes` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Discovery | Global route search | View | `GET /api/search/routes?q=` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Discovery | Test-centre search / nearest | View | `GET /api/search/test-centres` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Routes | Route detail | View | `GET /api/routes/:id` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Routes | Instructor's routes | View | `GET /api/routes/by-instructor/:userId` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Routes | Access decision (dry run) | View | `GET /api/routes/:id/access` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Routes | Playback manifest | View | `GET /api/routes/:id/playback` | ❌ | 💳 | 💳 | 💳 | 💳 | 💳 |
| Routes | Practice instructions | View | `GET /api/routes/:id/practice` | ❌ | 💳 | 💳 | 💳 | 💳 | 💳 |
| Routes | GPS track | View | `GET /api/routes/:id/track` | ❌ | 💳 | 💳 | 💳 | 💳 | 💳 |
| Routes | HLS asset gateway | Download | `GET /api/routes/:id/hls/:token/:view/:file` | 🌐 (signed token is the credential) | | | | | |
| Routes | Watch-time beacon | Execute | `POST /api/routes/:id/watch` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Subscriptions | Plans | View | `GET /api/subscriptions/plans` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Subscriptions | Own subscription | View | `GET /api/subscriptions/me` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Subscriptions | Stripe checkout | Execute | `POST /api/subscriptions/checkout` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Account | Own profile | View | `GET /api/users/me` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Account | Own profile | Edit | `PATCH /api/users/me` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Account | Contact details | Delete | `DELETE /api/users/me/contact` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Account | Test details | View / Create | `GET`/`POST /api/users/me/test-details` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Account | GDPR export | Execute | `POST /api/users/me/export` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Account | GDPR erasure | Delete | `DELETE /api/users/me` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Progress | Own progress | View | `GET /api/users/me/progress` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Progress | Own history | View | `GET /api/users/me/history` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Progress | Session complete | Execute | `POST /api/routes/:id/session-complete` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Progress | AI session summary | View | `GET /api/routes/:id/summary` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Offline | Request package | Create | `POST /api/routes/:id/offline` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Offline | Package URL | Download | `GET /api/routes/:id/offline` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Offline | Revoke package | Delete | `DELETE /api/routes/:id/offline` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Offline | Own packages | View | `GET /api/users/me/offline` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Notifications | Register device | Create | `POST /api/notifications/register` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Notifications | Unregister device | Delete | `DELETE /api/notifications/register/:token` | ❌ | ⚠ see note | ⚠ | ⚠ | ⚠ | ⚠ |
| Notifications | Own notifications | View | `GET /api/notifications` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Notifications | Mark read | Edit | `PATCH /api/notifications/:id/read` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |

> ⚠ `DELETE /api/notifications/register/:token` takes the token from the URL and does
> **not** scope it to the caller. See `PERM-045` and [13-TESTING-GAPS.md](13-TESTING-GAPS.md).

---

## 4. Booking modules

| Module | Feature | Action | Method + endpoint | anon | user | contributor | instructor | moderator | admin |
|---|---|---|---|---|---|---|---|---|---|
| Bookings | Instructor search | View | `GET /api/instructors` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bookings | Instructor public profile | View | `GET /api/instructors/:id/profile` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bookings | Instructor open slots | View | `GET /api/instructors/:id/slots` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bookings | Booking | Create | `POST /api/bookings` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bookings | Own bookings | View | `GET /api/bookings/mine` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Bookings | Booking status | Edit | `PATCH /api/bookings/:id` | ❌ | 🔒 | 🔒 | 🔒 | ✅ (any) | ✅ (any) |
| Instructor | Own instructor profile | Edit | `PUT /api/instructors/me/profile` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Instructor | Own availability | View | `GET /api/instructors/me/slots` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Instructor | Availability slot | Create | `POST /api/instructors/me/slots` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Instructor | Availability slot | Delete | `DELETE /api/instructors/me/slots/:slotId` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Instructor | Bookings received | View | `GET /api/instructors/me/bookings` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Admin | All bookings | View | `GET /api/admin/bookings` | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

> Note the row **`PUT /api/instructors/me/profile` — admin ❌**. `@Roles('instructor')`
> is exclusive; `admin` is not implicitly included. Verify this returns 403 for an admin
> token (`PERM-014` … `PERM-016`).

---

## 5. Contribution modules

| Module | Feature | Action | Method + endpoint | anon | user | contributor | instructor | moderator | admin |
|---|---|---|---|---|---|---|---|---|---|
| Community | Badge catalogue | View | `GET /api/badges` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Community | Leaderboards | View | `GET /api/leaderboards?period=` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Community | Contributor profile | View | `GET /api/contributors/:id` | 🌐 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Community | Own contributor profile | View | `GET /api/contributors/me/profile` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Community | Footage agreement | Execute | `POST /api/contributors/agreement` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Community | Badge evidence upload URL | Create | `POST /api/instructors/verify/evidence-upload` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Community | ADI application | Create | `POST /api/instructors/verify` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Community | Own ADI status | View | `GET /api/instructors/me/status` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Uploads | Start upload | Create | `POST /api/uploads` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Uploads | Complete upload | Execute | `POST /api/uploads/:id/complete` | ❌ | ❌ | ❌ | 🔒 | ❌ | 🔒 |
| Uploads | Upload status | View | `GET /api/uploads/:id` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Uploads | Sign multipart parts | Execute | `POST /api/uploads/:id/parts` | ❌ | ❌ | ❌ | 🔒 | ❌ | 🔒 |
| Uploads | Complete multipart | Execute | `POST /api/uploads/:id/parts/complete` | ❌ | ❌ | ❌ | 🔒 | ❌ | 🔒 |
| Uploads | Abort upload | Delete | `DELETE /api/uploads/:id` | ❌ | ❌ | ❌ | 🔒 | ❌ | 🔒 |
| Uploads | Attach video to map-only route | Create | `POST /api/uploads/routes/:routeId/attach-video` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Journeys | Reference route | Create | `POST /api/reference-routes` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Journeys | Reference routes | View | `GET /api/reference-routes` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Journeys | Reference route detail | View | `GET /api/reference-routes/:id` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Journeys | Start journey | Create | `POST /api/journeys` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Journeys | Live deviation check | Execute | `POST /api/journeys/:id/check` | ❌ | ❌ | ❌ | 🔒 | ❌ | 🔒 |
| Journeys | Submit journey | Execute | `POST /api/journeys/:id/submit` | ❌ | ❌ | ❌ | 🔒 | ❌ | 🔒 |
| Journeys | Journey report | View | `GET /api/journeys/:id` | ❌ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Journeys | Own journeys | View | `GET /api/instructors/me/journeys` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |

> `GET /api/uploads/:id` carries **no `@Roles`** decorator, so any authenticated role can
> call it — but `getOwned()` restricts it to the uploader. Test both halves (`PERM-032`).

---

## 6. Admin console modules

Class-level default on [admin.controller.ts](../apps/api/src/modules/admin/admin.controller.ts)
is `@Roles('moderator','admin')`. Rows marked **admin-only** carry a method-level
`@Roles('admin')` that overrides it.

| Module | Feature | Action | Method + endpoint | user / contributor / instructor | moderator | admin |
|---|---|---|---|---|---|---|
| Admin console | Console page | View | `/admin` (web) | ❌ redirect to `/test-centres` | ✅ | ✅ |
| Review Queue | Pending / flagged routes | View | `GET /api/admin/review-queue` | ❌ | ✅ | ✅ |
| Review Queue | Route detail + pipeline | View | `GET /api/admin/routes/:id` | ❌ | ✅ | ✅ |
| Review Queue | Route | **Approve** | `POST /api/admin/routes/:id/moderate` `{decision:"approve"}` | ❌ | ✅ | ✅ |
| Review Queue | Route | **Reject** | `POST /api/admin/routes/:id/moderate` `{decision:"reject"}` | ❌ | ✅ | ✅ |
| Analytics | Header stat tiles + nav badges | View | `GET /api/admin/analytics` | ❌ | ✅ | ✅ |
| Revenue | Subscription revenue / MRR | View | `GET /api/admin/revenue` | ❌ | ❌ **admin-only** | ✅ |
| Users | User search (incl. phone) | View | `GET /api/admin/users?q=` | ❌ | ✅ | ✅ |
| Users | Role | **Assign** | `PATCH /api/admin/users/:id` `{role}` | ❌ | ❌ **admin-only** | ✅ |
| Users | Account | **Suspend / reinstate** | `PATCH /api/admin/users/:id` `{isSuspended}` | ❌ | ❌ **admin-only** | ✅ |
| Instructors | Pending ADI applications | View | `GET /api/admin/instructors` | ❌ | ✅ | ✅ |
| Instructors | Badge evidence | Download | `GET /api/admin/instructors/:id/evidence` | ❌ | ✅ | ✅ |
| Instructors | Application | **Approve / reject** | `POST /api/admin/instructors/:id/verify` | ❌ | ✅ | ✅ |
| Reports | Open abuse reports | View | `GET /api/admin/reports` | ❌ | ✅ | ✅ |
| Reports | Moderation log | View | `GET /api/admin/moderation-log` | ❌ | ✅ | ✅ |
| Community Fund | Summary + transactions | View | `GET /api/admin/fund/summary` | ❌ | ✅ | ✅ |
| Community Fund | Beneficiaries | View | `GET /api/admin/fund/beneficiaries` | ❌ | ✅ | ✅ |
| Community Fund | Beneficiary | **Create** | `POST /api/admin/fund/beneficiaries` | ❌ | ❌ **admin-only** | ✅ |
| Community Fund | Allocation | **Create** | `POST /api/admin/fund/allocate` | ❌ | ❌ **admin-only** | ✅ |
| Community Fund | Payout | **Execute** | `POST /api/admin/fund/payout` | ❌ | ❌ **admin-only** | ✅ |
| Community Fund | Monthly contribution | **Execute** | `POST /api/admin/fund/run-contribution` | ❌ | ❌ **admin-only** | ✅ |
| Instructor Earnings | Attribution runs | View | `GET /api/admin/revshare/runs` | ❌ | ✅ | ✅ |
| Instructor Earnings | Run detail | View | `GET /api/admin/revshare/runs/:period` | ❌ | ✅ | ✅ |
| Instructor Earnings | Instructor balances | View | `GET /api/admin/revshare/instructors` | ❌ | ✅ | ✅ |
| Instructor Earnings | Attribution run | **Execute** | `POST /api/admin/revshare/run` | ❌ | ❌ **admin-only** | ✅ |
| Reference Routes | R1 list / create | View / Create | `GET`/`POST /api/reference-routes` | View ✅ / Create instructor+admin | View ✅ / Create ❌ | ✅ |

---

## 7. Machine-to-machine endpoints

| Endpoint | Protection | Expected when credential is wrong / missing |
|---|---|---|
| `POST /api/internal/journeys/analyse-upload` | `WorkerSecretGuard`, header `x-worker-secret` | **403** with a wrong secret; **403** `Missing worker credentials` with none; **503** `Internal worker API is not configured` when `WORKER_SHARED_SECRET` is unset |
| `POST /api/webhooks/stripe` | Stripe signature over the raw body | **400** `Webhook signature verification failed` |
| `POST /api/webhooks/revenuecat` | `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>` | **401** — **but the check is skipped entirely when the env var is unset.** See `PERM-056` |
| `POST /api/webhooks/worker/upload-status` | **None found** | Currently accepts any caller. See `PERM-057` — treat as a security finding |
| `GET /api/health` | None (intentional) | 200 with `{status, db, time}` |

---

## 8. Front-end route guard matrix

| URL path | anon | user / contributor | instructor | moderator | admin |
|---|---|---|---|---|---|
| `/login` | Page | → `/` | → `/` | → `/` | → `/` |
| `/forgot-password`, `/reset-password`, `/verify-email` | Page | **Page** (deliberately not redirected) | Page | Page | Page |
| `/` | → `/login` | → `/test-centres` | → `/test-centres` | → `/admin` | → `/admin` |
| `/admin` | → `/login` | → `/test-centres` | → `/test-centres` | Page | Page |
| `/test-centres`, `/discover`, `/route/:id`, `/account`, `/bookings`, `/paywall`, … | → `/login` | Page | Page | Page | Page |
| `/test-centres/new`, `/test-centres/:id/edit` | → `/login` | **Page renders** — the API rejects the save | Page | **Page renders** — API rejects | Page |
| `/contribute`, `/contribute/upload`, `/contribute/record` | → `/login` | **Page renders** with a "verified instructors only" message | Page | Page renders, gated content | Page |
| `/instructors/me` | → `/login` | Page renders — API returns 403 for slots/profile | Page | Page renders — 403 | Page renders — 403 |
| unknown path | → `/login` | → `/` | → `/` | → `/` | → `/` |

> There is **no front-end route guard** on `/test-centres/new`, `/contribute/*` or
> `/instructors/me`. Those pages render for any signed-in user and rely on the API to
> refuse the action. Confirm the failure is a clear message rather than a broken page —
> `PERM-023` … `PERM-029`.
</content>
