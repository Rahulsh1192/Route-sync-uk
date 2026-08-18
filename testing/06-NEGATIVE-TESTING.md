# 06 — Negative Testing

**Prefix:** `NEG-###` for input and behaviour · `PERM-###` for authorisation

Module-specific negative cases live in each module document. This file holds the
**cross-cutting** ones, plus the complete authorisation-bypass suite.

---

## 1. Authorisation bypass suite (`PERM-###`)

Run every one of these at **API level with a real bearer token for the stated role**.
A UI restriction that is not matched by an API restriction is a defect regardless of how
well the UI hides the control.

### 1.1 Privilege escalation — highest severity

| Test ID | Role | Attempt | Expected | Severity if it succeeds |
|---|---|---|---|---|
| PERM-001 | user | `PATCH /api/admin/users/<own id>` `{"role":"admin"}` | **403** | **Critical** — total compromise |
| PERM-002 | user | `PATCH /api/users/me` `{"role":"admin"}` | **400** (unknown property) | **Critical** |
| PERM-003 | instructor | `POST /api/admin/routes/<own route>/moderate` `{"decision":"approve"}` | **403** | **Critical** — self-publishing |
| PERM-004 | instructor | `POST /api/admin/instructors/<own application>/verify` `{"decision":"verified"}` | **403** | **Critical** — self-verification |
| PERM-005 | moderator | `PATCH /api/admin/users/<own id>` `{"role":"admin"}` | **403** | **Critical** |
| PERM-006 | contributor | `POST /api/uploads` | **403** | High |
| PERM-007 | any | `POST /api/internal/journeys/analyse-upload` with a user JWT and no `x-worker-secret` | **403 / 503** | **Critical** — the internal surface must never accept a user token |

### 1.2 Role-gated endpoints

| Test ID | Endpoint | Denied roles | Expected |
|---|---|---|---|
| PERM-008 | `POST`/`PATCH`/`DELETE /api/test-centres` | user, contributor, **moderator** | 403 |
| PERM-009 | `GET /api/test-centres/lookup/postcode` | user, contributor, moderator | 403 |
| PERM-010 | `POST /api/uploads` and every `/api/uploads/*` write | user, contributor, moderator | 403 |
| PERM-011 | `POST /api/reference-routes` | user, contributor, moderator | 403 |
| PERM-012 | `POST /api/journeys`, `/:id/check`, `/:id/submit` | user, contributor, moderator | 403 |
| PERM-013 | `GET /api/instructors/me/journeys` | user, contributor, moderator | 403 |
| PERM-014 | `PUT /api/instructors/me/profile` | user, contributor, moderator, **admin** | 403 |
| PERM-015 | `GET`/`POST`/`DELETE /api/instructors/me/slots` | user, contributor, moderator, **admin** | 403 |
| PERM-016 | `GET /api/instructors/me/bookings` | user, contributor, moderator, **admin** | 403 |
| PERM-017 | every `/api/admin/*` | user, contributor, instructor | 403 |
| PERM-018 | `GET /api/admin/revenue` | **moderator** | 403 |
| PERM-019 | `PATCH /api/admin/users/:id` | **moderator** | 403 |
| PERM-020 | `POST /api/admin/fund/allocate`, `/beneficiaries`, `/payout`, `/run-contribution` | **moderator** | 403 |
| PERM-021 | `POST /api/admin/revshare/run` | **moderator** | 403 |
| PERM-022 | `GET /api/admin/bookings` | user, contributor, instructor | 403 |

### 1.3 Front-end guard bypass (route level)

These pages have **no client-side role guard**. Each must render safely and fail readably.

| Test ID | Role | URL typed directly | Expected |
|---|---|---|---|
| PERM-023 | user | `/test-centres/new` | Page renders; **Save returns 403** with a readable message |
| PERM-024 | user | `/test-centres/<id>/edit` | Same |
| PERM-025 | user | `/contribute` | Renders the "verified instructors only" message |
| PERM-026 | user | `/contribute/upload` | Same gated message; the wizard is not offered |
| PERM-027 | user | `/contribute/record` | Same |
| PERM-028 | user | `/instructors/me` | Renders; data calls 403; must degrade readably, not blank |
| PERM-029 | admin | `/instructors/me` | Renders; data calls 403 (`@Roles('instructor')` excludes admin) |
| PERM-030 | user / instructor | `/admin` | Redirected to `/test-centres` |
| PERM-031 | anon | any protected path | Redirected to `/login` |

### 1.4 Data-scope bypass (horizontal privilege)

Two accounts of the same role. Act as A against B's resource.

| Test ID | Attempt | Expected |
|---|---|---|
| PERM-032 | `GET /api/uploads/<B's upload id>` | **403 Not your upload** |
| PERM-033 | `POST /api/uploads/<B's upload id>/complete` | **403** |
| PERM-034 | `DELETE /api/uploads/<B's upload id>` | **403** |
| PERM-035 | `POST /api/uploads/<B's upload id>/parts` | **403** |
| PERM-036 | `GET /api/journeys/<B's journey id>` as a non-staff role | **403 Not your journey** |
| PERM-037 | `POST /api/journeys/<B's journey id>/submit` | **403** |
| PERM-038 | `PATCH /api/bookings/<B's booking id>` | **403 Not authorised to update this booking** |
| PERM-039 | `DELETE /api/instructors/me/slots/<B's slot id>` | **404 Slot not found** |
| PERM-040 | `GET /api/bookings/mine` — does any of B's data appear? | Only A's rows |
| PERM-041 | `GET /api/users/me/history` — does any of B's data appear? | Only A's rows |
| PERM-042 | `GET /api/users/me/offline` — does any of B's data appear? | Only A's rows |
| PERM-043 | `GET /api/notifications` — does any of B's data appear? | Only A's rows |
| PERM-044 | Submit an ADI application with **B's** `evidenceKey` | **400 That evidence upload does not belong to this account.** |
| PERM-045 | **`DELETE /api/notifications/register/<B's device token>`** | Should be refused. **The handler does not scope the token to the caller** — if it succeeds, this is a real authorisation defect. See [13](13-TESTING-GAPS.md) |

### 1.5 Entitlement bypass (paid content)

| Test ID | Attempt | Expected | Severity |
|---|---|---|---|
| PERM-046 | `GET /api/routes/<unentitled id>/playback` | **403** | **Critical** — free access to paid video |
| PERM-047 | `GET /api/routes/<unentitled id>/practice` | **403** | **Critical** |
| PERM-048 | `GET /api/routes/<unentitled id>/track` | **403** | High — the GPS track is paid content too |
| PERM-049 | Reuse route A's HLS token against route B | **403 Token is for a different route** | **Critical** |
| PERM-050 | Tamper with one character of an HLS token | **403 Invalid playback token** | **Critical** |
| PERM-051 | Use an HLS token after `SIGNED_URL_TTL` | **403 Playback token has expired** | High |
| PERM-052 | `GET /api/routes/<id>` unauthenticated — inspect the payload | Metadata and preview only. **No stream URL, no GPS track, no instruction text** | **Critical** if paid content leaks |
| PERM-053 | `POST /api/routes/<id>/offline` on a free plan | **403** | Medium |

### 1.6 Machine-to-machine

| Test ID | Attempt | Expected |
|---|---|---|
| PERM-054 | `POST /api/webhooks/stripe` with no or a wrong `stripe-signature` | **400**. A 200 would let anyone grant themselves Premium — **critical** |
| PERM-055 | `POST /api/webhooks/revenuecat` with `REVENUECAT_WEBHOOK_SECRET` **set** and a wrong bearer | **401** |
| PERM-056 | `POST /api/webhooks/revenuecat` with the secret **unset** and no auth header | **The check is skipped entirely.** Confirm and raise — see [13](13-TESTING-GAPS.md) |
| PERM-057 | **`POST /api/webhooks/worker/upload-status`** with no credential at all, changing another user's upload status | **No guard exists on this endpoint.** Confirm and raise as a security finding — see [13](13-TESTING-GAPS.md) |
| PERM-058 | `POST /api/internal/journeys/analyse-upload` with no header | **403 Missing worker credentials** |
| PERM-059 | Same with a wrong secret | **403 Invalid worker credentials** |
| PERM-060 | Same with `WORKER_SHARED_SECRET` unset | **503**, never open access |

---

## 2. Input validation (`NEG-###`)

The API uses a global `ValidationPipe` with `whitelist: true`,
`forbidNonWhitelisted: true` and `transform: true`
([main.ts](../apps/api/src/main.ts)). Unknown properties are therefore rejected with a
**400**, not silently stripped.

| Test ID | Scenario | Expected |
|---|---|---|
| NEG-001 | Send an **unknown property** to any DTO endpoint (e.g. `POST /api/auth/register` with `{"isAdmin":true}`) | **400** naming the forbidden property |
| NEG-002 | Send a **wrong type** (e.g. `POST /api/routes/:id/watch` with `secondsWatched:"abc"`) | **400** |
| NEG-003 | Omit a **required** field on any DTO endpoint | **400** naming the field |
| NEG-004 | Send an **empty body** to a POST that expects one | **400** |
| NEG-005 | Send **malformed JSON** | **400**, not a 500 |
| NEG-006 | Send a **malformed UUID** where `ParseUUIDPipe` is used (`/api/uploads/:id/parts`, `/api/routes/:id/hls/...`) | **400** |
| NEG-007 | Send a **malformed UUID** where it is **not** used but the service casts to `::uuid` (`/api/test-centres/not-a-uuid`, `/api/routes/not-a-uuid`) | Record the exact status. **A 500 for a malformed id is a defect** — see [13](13-TESTING-GAPS.md) |
| NEG-008 | Exceed a `@MaxLength` (test-centre name > 160, description > 1000, emergency name > 120, evidence key > 300) | **400** |
| NEG-009 | Undercut a `@MinLength` (password < 8, display name < 2, centre name < 2, ADI number < 3) | **400** |
| NEG-010 | Exceed a `@Max` (`secondsWatched` > 86 400, `travelRadiusKm` > 100, part number > 10 000) | **400** |
| NEG-011 | Undercut a `@Min` (`lessonPriceMinor` < 0, `yearsExperience` < 0, `amountMinor` < 1, `tMs` < 0) | **400** |
| NEG-012 | Send an invalid enum value (`plan:"gold"`, `role:"superuser"`, `decision:"maybe"`, `kind:"sideways"`, `gpsSource:"psychic"`) | **400** |
| NEG-013 | Send an invalid date string where `@IsDateString` applies (`slotDate`, `adiExpiry`, `testDate`) | **400** |
| NEG-014 | **Send a string that only the database validates** — `PATCH /api/bookings/:id` with `{"status":"hacked"}`, or `POST /api/instructors/me/slots` with `{"startTime":"25:99"}` | Record the exact status. **A 500 here is a defect** — the DTO validates these only as strings. See `BOOK-035`, `INST-025` |
| NEG-015 | Send an invalid phone format to register, `PATCH /api/users/me` | **400** with the phone message |
| NEG-016 | Send an invalid SHA-256 (`sha256:"NOTAHEX"`) | **400** |
| NEG-017 | Send out-of-range coordinates (`lat:95`, `lng:200`) | **400** |
| NEG-018 | Send an oversized array (`fixes` with 200 001 entries) | **400 GPS track is too large** |
| NEG-019 | Send an undersized array (`points` with 1 entry, `fixes` with 1 entry) | **400** |

---

## 3. Missing, deleted and non-existent resources

| Test ID | Scenario | Expected |
|---|---|---|
| NEG-020 | `GET /api/routes/<valid-but-nonexistent uuid>` | **404 Route not found** |
| NEG-021 | `GET /api/test-centres/<nonexistent uuid>` | **404** |
| NEG-022 | `GET /api/reference-routes/<nonexistent uuid>` | **404 Reference route not found** |
| NEG-023 | `GET /api/journeys/<nonexistent uuid>` | **404 Journey not found** |
| NEG-024 | `GET /api/uploads/<nonexistent uuid>` | **404 Upload not found** |
| NEG-025 | `GET /api/contributors/<nonexistent uuid>` | **404 Contributor not found** |
| NEG-026 | `GET /api/instructors/<a non-verified user id>/profile` | **404 Instructor not found** |
| NEG-027 | `GET /api/admin/instructors/<nonexistent uuid>/evidence` | **404 Verification not found** |
| NEG-028 | `GET /api/routes/<in_review route id>` | **404** — unpublished routes are invisible, **even to an admin** through this endpoint |
| NEG-029 | Open a route detail page in one tab; delete/unpublish the route; then click **Watch** in that tab | A clean 404 or a readable error — **not** a blank screen or an infinite spinner |
| NEG-030 | Book a slot that was deleted between page load and submit | **400 Slot not available** |
| NEG-031 | `GET /api/routes/<id>/offline` before requesting a package | **404 No offline package found — request one first** |

---

## 4. Duplicate and conflicting data

| Test ID | Scenario | Expected |
|---|---|---|
| NEG-032 | Register with an already-registered email | **409 Email already registered** |
| NEG-033 | Create a test centre with an existing name | Conflict with a readable message — **not a 500** |
| NEG-034 | Submit a second ADI application while one is pending | **409 A verification request is already pending** |
| NEG-035 | Submit an ADI application with another account's ADI number | **409** naming the number — **not a 500** |
| NEG-036 | Add an availability slot with the same date and start time twice | **409 Slot already exists** |
| NEG-037 | Book an already-booked slot | **400 Slot not available** |
| NEG-038 | Accept the footage agreement twice | Idempotent — the same response, **no duplicate row** |
| NEG-039 | Replay the same Stripe webhook event twice | Exactly one subscription; no double entitlement |
| NEG-040 | Run the monthly fund contribution twice for the same period | The second run is **skipped** |
| NEG-041 | Run rev-share attribution twice for the same period | The second run is **skipped** |

---

## 5. Rate limiting and abuse

| Test ID | Scenario | Expected |
|---|---|---|
| NEG-042 | 130 requests to any endpoint from one IP within a minute | **429** |
| NEG-043 | 4 calls to `POST /api/auth/verify-email/resend` within a minute | The 4th is **429** |
| NEG-044 | 6 calls to `POST /api/auth/forgot-password` within a minute | The 6th is **429** |
| NEG-045 | 11 calls to `POST /api/auth/verify-email` or `/reset-password` within a minute | The 11th is **429** |
| NEG-046 | 6 verification emails for one account within an hour | Still 202, but no 6th email; the log shows `Rate-limited` |
| NEG-047 | Repeated failed logins for one account | **No lockout exists** — only the IP throttle applies. Confirm and record; see [13](13-TESTING-GAPS.md) |
| NEG-048 | Rapid repeated clicks on **Watch**, **Book**, **Approve**, **Save** | Exactly one effect per action. Duplicate bookings, duplicate approvals or duplicate slots are defects |

---

## 6. Repeated submission and idempotency

| Test ID | Scenario | Expected |
|---|---|---|
| NEG-049 | Double-click **Book** on the same slot | One booking; the second attempt gets **400 Slot not available** |
| NEG-050 | Double-click **Approve** on a queued route | One `approvals` row per click is acceptable, but the route must end in a consistent state. Note that there is **no state guard** — see `ADM-RQ-021` |
| NEG-051 | Submit the ADI application form twice quickly | The second is **409** |
| NEG-052 | Submit the register form twice quickly | The second is **409 Email already registered** |
| NEG-053 | Click **Run now** twice on the fund contribution | The second is skipped |
| NEG-054 | Re-POST a completed Stripe checkout | No duplicate subscription |
</content>
