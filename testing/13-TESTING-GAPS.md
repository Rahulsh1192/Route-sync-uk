# 13 — Potential Testing Gaps and Issues

Everything here was derived by reading the implementation. Nothing is called a bug unless
the code clearly demonstrates it.

**Labels used**

| Label | Meaning |
|---|---|
| **Potential Issue** | The code suggests a defect. **Confirm by test before raising a bug.** |
| **Needs Clarification** | The implementation does not determine the expected behaviour. Escalate to the product owner — do not pass or fail it. |
| **Not Implemented** | The feature is absent from the code. Not a bug; a gap. |
| **Untestable** | Cannot be exercised in the available environment. |

---

## 1. Authorisation — Potential Issues

### PI-01 — `POST /api/webhooks/worker/upload-status` has no authentication
**Potential Issue · Severity: High**

[webhooks.controller.ts](../apps/api/src/modules/webhooks/webhooks.controller.ts) —
the handler carries no guard, no signature check and no shared-secret check. It accepts an
`uploadId`, a `status` and an `error` and writes them straight to the `uploads` table.

Every other internal surface in the codebase is protected: `WorkerSecretGuard` closes the
journeys endpoint when the secret is unset, and the Stripe and RevenueCat webhooks verify
their callers. This one appears to have been missed.

**Test:** `PERM-057`. **Confirm** that an unauthenticated caller can change another user's
upload status before raising it.

### PI-02 — RevenueCat webhook auth is skipped when the secret is unset
**Potential Issue · Severity: High (deployment-dependent)**

`if (secret && auth !== 'Bearer ' + secret) throw …` — when
`REVENUECAT_WEBHOOK_SECRET` is not configured the check is skipped **entirely**, so an
unauthenticated caller can post an `INITIAL_PURCHASE` event and be granted a subscription.

Compare `WorkerSecretGuard`, which deliberately **closes** its endpoint (503) rather than
opening it when unconfigured. **Test:** `PERM-056`, `SUB-022`.

### PI-03 — `DELETE /api/notifications/register/:token` is not scoped to the caller
**Potential Issue · Severity: Medium**

[notifications.controller.ts](../apps/api/src/modules/notifications/notifications.controller.ts)
takes the token from the URL and passes it to `unregisterDevice(token)` without the
caller's id. Every other handler in that controller takes `@CurrentUser()`.

**Test:** `PERM-045`, `API-013`.

### PI-04 — No self-protection on admin user management
**Potential Issue · Severity: Medium**

`updateUser()` has no check preventing an admin from suspending their own account,
demoting themselves, or demoting the **last remaining admin**. The latter is potentially
an unrecoverable lockout without direct database access.

**Test:** `ADM-USR-021`, `ADM-USR-022`, `ROLE-ADM-021`, `ROLE-ADM-022`.

### PI-05 — Any instructor can delete any test centre
**Potential Issue · Severity: Medium**

`@Roles('instructor','admin')` on `DELETE /api/test-centres/:id`, and
`TestCentresService.remove()` has **no ownership check** — only a guard that the centre has
no routes. Any verified instructor can delete any empty centre created by anyone.

**Test:** `ROLE-INS-032`, `ROLE-ADM-027`.

---

## 2. UI / API permission inconsistencies

### PI-06 — The admin console shows moderators controls they cannot use
**Potential Issue · Severity: Low (usability) / Medium (perception)**

`AdminProtected` admits `moderator`, and `AdminApp` renders **all nine** nav items
unconditionally. But these are `@Roles('admin')`:
Revenue · user role/suspend · fund beneficiary/allocate/payout/run-contribution ·
revshare run. And these exclude moderator entirely: test-centre writes, reference-route
creation.

So a moderator sees the **Revenue** nav item, the Users **Role** select, the Fund forms,
both **Run now** buttons and the Reference Routes create form — and every one of them
403s. Nothing is hidden or disabled.

**Test:** `PERM-018` … `PERM-022`, `ROLE-MOD-015` … `ROLE-MOD-022`, `ADM-FIN-004`,
`ADM-USR-025`.

### PI-07 — Pages with no client-side role guard
**Potential Issue · Severity: Low**

`/test-centres/new`, `/test-centres/:id/edit`, `/contribute/*` and `/instructors/me` are
wrapped only in `Protected` (authentication), not in any role check. They render for every
signed-in user and rely on the API to refuse the action.

`/contribute/*` handles this well — it shows a "verified instructors only" message. The
test-centre forms and `/instructors/me` do **not**: they render as if usable and fail on
save.

**Test:** `PERM-023` … `PERM-029`, `TC-031`, `TC-032`, `INST-034`.

### PI-08 — The two "staff" definitions disagree about `moderator`
**Needs Clarification**

`isAdminRole()` (App.tsx) = `admin` | `moderator` → controls `/admin`.
`isStaffRole()` (types.ts) = `instructor` | `admin` → controls the main-app navigation.

A moderator therefore lands on the admin console but gets **learner** navigation in the
main app: no Contribute tab, no "+ New test centre". That is consistent with the API
(moderators genuinely cannot write test centres), so it may be intentional — but it is
also why `/account` has **no branch at all** for `moderator`.

**Question for the product owner:** what should a moderator see in the main app, and what
should `/account` render for them? **Test:** `ROLE-MOD-013`, `ROLE-MOD-014`, `ACCT-016`.

---

## 3. Validation and error-handling gaps

### PI-09 — `PATCH /api/bookings/:id` does not validate `status`
**Potential Issue · Severity: Medium**

`UpdateBookingDto.status` is typed as a union in TypeScript but decorated only with
`@IsString()` — there is no `@IsIn([...])`. An arbitrary string therefore reaches a
`booking_status` enum column and fails at the database, which surfaces as a **500** for
what should be a **400**.

**Test:** `BOOK-035`, `NEG-014`.

### PI-10 — No booking-transition rules
**Potential Issue · Severity: Medium (business logic)**

`updateBooking()` checks *who* may act (learner, instructor, admin/moderator) but not
*which transition* they may make. A **learner** can mark their own lesson `completed` or
`no_show`; a `cancelled` booking can be set back to `confirmed` **without** re-booking the
slot, leaving the booking and the slot out of step.

**Test:** `BOOK-036`, `BOOK-037`, `STATE-019`.

### PI-11 — Availability slot times are not validated
**Potential Issue · Severity: Low**

`AddAvailabilitySlotDto` validates `slotDate` as a date string but `startTime` and
`endTime` only as `@IsString()`. There is no check that the end is after the start, no
check that the date is in the future, and a malformed time (`"25:99"`) reaches a `time`
column cast.

**Test:** `INST-023`, `INST-024`, `INST-025`.

### PI-12 — Malformed UUIDs reach raw SQL casts
**Potential Issue · Severity: Low**

`ParseUUIDPipe` is used on some routes (`/api/uploads/:id/parts`,
`/api/routes/:id/hls/...`) but not on most. Elsewhere the id goes straight into a
`${id}::uuid` cast in raw SQL, so `/api/test-centres/not-a-uuid` produces a database
error — a **500** where a **400** is correct.

**Test:** `NEG-007`, `TC-014`.

### PI-13 — No state guard on moderation decisions
**Potential Issue · Severity: Medium**

`moderate()` and `verifyInstructor()` both act on whatever state the record is in:

- An **already-published** route can be re-moderated to `rejected` and vanishes from
  learners.
- An **already-verified** ADI can be re-decided as `rejected`, which sets
  `instructor_status = 'rejected'` but **leaves `users.role = 'instructor'`** — an
  inconsistent pair where the user keeps upload rights but disappears from instructor
  search.

**Test:** `ADM-RQ-021`, `ADM-INS-018`, `STATE-007`, `STATE-024`.

### PI-14 — `POST /api/admin/revshare/run` with a malformed period
**Potential Issue · Severity: Low**

`periodBounds()` splits the period on `-` and passes both halves through `Number`. A
malformed value produces `NaN` dates and a run over an undefined window.

**Test:** `ADM-FIN-024`.

### PI-15 — `GET /api/admin/bookings?page=-1`
**Potential Issue · Severity: Low**

`ParseIntPipe` accepts a negative integer, which becomes a negative SQL `OFFSET`.

**Test:** `ADM-BKG-010`.

---

## 4. Pricing inconsistency

### PI-16 — Yearly price is £39.99 in two places and £29.99 in a third
**Potential Issue · Severity: Medium (reporting accuracy)**

| Location | Yearly value |
|---|---|
| `SubscriptionsService.plans()` — the price shown to the customer | **3999** (£39.99) |
| `fund.constants.ts` `PRICE_YEARLY_MINOR` — the fund formula | **3999** (£39.99) |
| **`AdminService.revenue()`** — the MRR calculation | **2999** (£29.99) |
| `db/seed.sql` / `seed_more.sql` — seeded `price_minor` | 2999 |

The MRR figure in the admin Revenue panel therefore understates real revenue by ~25 % for
yearly subscribers. The `fund.constants.ts` comment says 3999 "matches the checkout/paywall
price", which suggests the revenue calculation is the one that was not updated.

**Test:** `ADM-FIN-003`.

---

## 5. Features that exist in the API but have no UI

**Not Implemented (UI)** — the endpoints work; test them through Swagger. See
[modules/api-only-modules.md](modules/api-only-modules.md).

| Feature | API | UI |
|---|---|---|
| Offline packages | Fully implemented, Premium-gated | **None** |
| Notifications | Fully implemented | **None** |
| Badges and leaderboards | Fully implemented, public | **None** (contributor stats appear on `/contribute`) |
| Test details (test centre + test date) | Fully implemented | **None** — the Phase 19b gate was retired |
| Google / Apple sign-in | Fully implemented and unit-tested | **No buttons** in the web app |
| Reporting content for moderation | The `reports` table and the admin read endpoint exist | **No way to create a report**, and no way to action one |

---

## 6. Features that are wired up but never invoked

### PI-17 — Progress and history are never written
**Potential Issue · Severity: Medium (feature does not work)**

`ProgressService.recordWatch()` and `recordPractice()` are the only writers of
`user_route_history`, and **no controller calls either**. The web app never calls
`POST /api/routes/:id/session-complete`. No seed file inserts into those tables.

**Result:** `/account/progress` always shows zeros and an empty history, no matter how much
a learner watches. See [modules/progress-history.md](modules/progress-history.md).

### PI-18 — `EntitlementGuard` / `@RequirePremium()` is defined but never applied
**Needs Clarification**

[entitlement.guard.ts](../apps/api/src/common/guards/entitlement.guard.ts) implements a
premium gate, but no controller decorates any handler with `@RequirePremium()`. Entitlement
is enforced instead by `resolveAccess()` inside `RoutesService`, and by a direct
`isPremium()` call in `OfflineService`.

Not a defect — but worth confirming that no endpoint was *meant* to carry it.

### PI-19 — `archived` route status is never set
**Needs Clarification**

The `route_status` enum includes `archived` but no code path writes it. Confirm whether
archiving is a planned feature or dead enum surface.

### PI-20 — Notification helpers may not be called
**Needs Clarification**

`NotificationsService` exposes `notifyBookingConfirmed`, `notifyBookingCancelled` and
`notifyNewBookingRequest`. Confirm during `API-012` whether the booking flow actually calls
them. If not, no notification is ever generated by any user action.

### PI-21 — GDPR export and media erasure are `TODO`s
**Not Implemented**

- `requestExport()` records a `data_requests` row and returns `{status:'accepted'}`. The
  comment reads `// TODO: enqueue BullMQ job to assemble export`. **No file is ever
  produced.**
- `requestErasure()` anonymises and soft-deletes the account and revokes tokens, but
  `// TODO: enqueue BullMQ job to purge media/uploads owned by this user` — **the user's
  uploaded media remains**.

Both have compliance implications. **Test:** `ACCT-019`, `ACCT-020`, `ERR-046`, `ERR-047`.

### PI-22 — No ADI expiry enforcement
**Needs Clarification**

`adiExpired` is computed and surfaced to both the applicant and the moderator, but nothing
demotes the user, hides them from search, or blocks new bookings when the badge lapses.

**Test:** `IVER-027`, `STATE-025`.

---

## 7. Session and token model

### PI-23 — Suspension does not revoke live sessions
**Potential Issue · Severity: Medium**

`updateUser()` sets `is_suspended` but does not touch `refresh_tokens`. Login is blocked,
but a suspended user's **existing access token keeps working** until it expires (default
900 s), and their refresh token is still valid — so they can refresh and continue
indefinitely. Compare `resetPassword()`, which revokes everything.

**Test:** `EDGE-015`, `ADM-USR-023`, `E2E-005`.

### PI-24 — Role changes do not take effect until the token refreshes
**Needs Clarification**

The role is a JWT claim, read by `JwtStrategy.validate()` without a database lookup. A
promotion or demotion therefore has no effect on a live session for up to
`JWT_ACCESS_TTL` (default 900 s).

This is a normal stateless-JWT trade-off, but it is user-visible: a newly approved
instructor sees no change until they sign out and back in. **Test:** `EDGE-014`,
`IVER-023`.

---

## 8. Documentation defects

### PI-25 — `docs/RUNNING_LOCALLY.md` lists migrations only up to phase 20
**Potential Issue · Severity: Medium (blocks setup)**

The setup loop stops at `migrate_phase_20.sql`, but the repository contains migrations
through `migrate_phase_28.sql`. Following that document produces a database missing the
Phase 26 contact columns, the Phase 24 clip timeline and the Phase 28 `email_tokens`
table — so registration, the contact form and the whole email flow will fail in ways that
look like product bugs.

The correct list is in [12-TEST-ENVIRONMENT-AND-DATA.md §2](12-TEST-ENVIRONMENT-AND-DATA.md).

### PI-26 — `docs/PROJECT_STATUS.md` is stale
**Documentation only**

It lists "Auth — email verification + password reset" as **not built**, but commit
`ab07bbe` shipped it and the pages exist. Treat the code as the source of truth.

---

## 9. Untestable in the available environment

| # | What | Why | What to do |
|---|---|---|---|
| U-01 | Email verification and password reset | The token is only ever in the email; only its SHA-256 is stored, so the link cannot be recovered from the database or the logs | Configure `RESEND_API_KEY` + `MAIL_FROM`, or ask the developers for a dev-mode token-logging switch |
| U-02 | The **signed HLS gateway** | Every seeded route's `manifest_key` is an **absolute external URL**, which bypasses the gateway entirely | Process a real upload through the worker first, then run `PLAY-014` … `PLAY-019` |
| U-03 | Google / Apple sign-in | No UI, and testing the API needs a real provider ID token | Out of scope, or test with a real token via Swagger |
| U-04 | The full media pipeline | Needs the Python worker, `WORKER_SHARED_SECRET`, real dashcam footage and GPS logs | Arrange the assets and the worker, or scope uploads to the API contract only |
| U-05 | Live GPS recording | Needs geolocation and real movement | Use a geolocation-mocking tool, or test the journey API directly with synthetic fixes |
| U-06 | AI session summaries | Needs Redis, the summary processor and whatever model credentials it uses | Confirm the configuration with the developers |
| U-07 | Mobile (Flutter) app | Out of scope for this pack; `PROJECT_STATUS.md` flags its screens as pre-Phase-20 and stale | Scope separately |
| U-08 | Push notifications | Device tokens can be registered, but no delivery path is exercisable from the web app | API-level only |
| U-09 | The **deployed** web app | The repository only ever refers to a placeholder `*.vercel.app` URL | Ask the platform owner for the real host |
| U-10 | Creating a **report** | No UI and no endpoint creates one | Insert directly into `reports`, or mark the panel untestable |

---

## 10. Questions for the product owner

Consolidated. None of these can be answered from the code.

| # | Question | Raised by |
|---|---|---|
| 1 | What is `contributor` **for**? No endpoint grants it anything a `user` lacks | [roles/contributor.md](roles/contributor.md) |
| 2 | Should a moderator have staff or learner navigation in the main app? | PI-08 |
| 3 | Should the console hide/disable controls a moderator cannot use? | PI-06 |
| 4 | Should a moderator be able to update **any** booking? | `ADM-BKG-013` |
| 5 | Should a moderator see learners' phone numbers, emergency contacts and ADI badge evidence? | `ADM-USR-010`, `ADM-BKG-017` |
| 6 | Should reads (`/api/test-centres`, `/api/routes`, `/api/search/*`, `/api/contributors/:id`) be **unauthenticated** at API level when the UI requires a session? | `TC-038`, `DISC-028`, `API-018` |
| 7 | Does a `past_due` subscription retain access? | `SUB-017` |
| 8 | Which party should be allowed to make which booking transition? | PI-10 |
| 9 | Should an expired ADI badge remove instructor privileges? | PI-22 |
| 10 | Should test centres have an ownership model? | PI-05 |
| 11 | Should `%` and `_` behave as wildcards in the search boxes? | `DISC-019`, `EDGE-070` |
| 12 | What is the supported browser and device matrix? | [11](11-RESPONSIVE-AND-ACCESSIBILITY.md) |
| 13 | What is the intended accessibility conformance target (WCAG 2.1 AA?) | [11](11-RESPONSIVE-AND-ACCESSIBILITY.md) |
| 14 | Should a learner be able to book a lesson with **themselves** if they are also an instructor? | `BOOK-027` |
| 15 | What should happen to a deleted user's published routes and instructor byline? | `ACCT-023` |
| 16 | Should watching a route resume where the learner left off? | `PLAY-023` |
| 17 | Is the `archived` route status planned, or dead? | PI-19 |
</content>
