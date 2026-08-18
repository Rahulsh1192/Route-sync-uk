# 05 — End-to-End Business Workflows

**Prefix:** `E2E-###`

These workflows deliberately cross module boundaries. A module can pass every one of its
own test cases and still fail here, because the failure is in the hand-off.

Run these **after** the individual module documents, and run them in the order given —
later workflows consume data the earlier ones create.

---

## Workflow map

```
E2E-001  Register -> browse -> free route -> paywall -> pay -> unlimited at one centre
E2E-002  Apply as ADI -> admin approves -> role change -> contribute rights
E2E-003  Instructor records R1 drive -> uploads footage -> admin approves -> learner watches
E2E-004  Learner books a lesson -> instructor confirms -> admin sees the commission
E2E-005  Admin suspends a user -> login blocked -> instructor vanishes from search -> reinstate
E2E-006  Admin creates a test centre -> instructor uploads to it -> centre cannot be deleted
E2E-007  Password reset -> every session revoked -> sign in with the new password
E2E-008  Booking cancelled -> slot released -> rebooked by someone else
E2E-009  Moderator's restricted journey through the console
```

---

## E2E-001 — New learner: register → free route → paywall → purchase

| | |
|---|---|
| **Roles** | `user` |
| **Modules crossed** | Auth → Test Centres → Route Access → Playback → Subscriptions → Access again |
| **Preconditions** | Stripe test keys configured and the Stripe CLI forwarding webhooks; a fresh, unregistered email address |

| # | Step | Expected result |
|---|---|---|
| 1 | Register a new account at `/login` | Account created; redirected via `/` to `/test-centres`; role is `user` |
| 2 | Search for `Mill Hill` and open the centre | The centre and its published routes render |
| 3 | Open a route and click **Watch** | **Plays** — this becomes the account's one free demo route. Confirm a `demo_route_claims` row now exists |
| 4 | Go back and open a **different** route at the **same** centre | The detail page shows the paywall notice |
| 5 | Click **Watch** on that second route | Redirected to `/paywall`, naming that route's test centre |
| 6 | Choose **Premium Monthly** | Redirected to Stripe Checkout |
| 7 | Pay with the test card `4242 4242 4242 4242` | Returned to `/billing/success` |
| 8 | Wait for the `checkout.session.completed` webhook | A `subscriptions` row exists with the correct `test_centre_id`, plan and `active` status |
| 9 | Reopen the second route and click **Watch** | **Plays** — no paywall |
| 10 | Open a route at a **different** centre | **Paywall** — Premium is per centre |
| 11 | Open `/account` | The Premium panel shows the active plan |

**Failure to watch for:** step 9 still showing the paywall means the webhook never
arrived, or `STRIPE_WEBHOOK_SECRET` is wrong. That is configuration — confirm before
raising a defect.

---

## E2E-002 — Learner becomes a verified instructor

| | |
|---|---|
| **Roles** | `user` → `instructor`, plus `admin` |
| **Modules crossed** | Account → Instructor Verification → Storage → Admin Instructors → Users → Navigation |
| **Preconditions** | A fresh learner account with no pending application; object storage running; an image file under 15 MB |

| # | Step | Role | Expected result |
|---|---|---|---|
| 1 | `/account` → **Become an instructor** | user | Navigates to `/contribute/instructor` |
| 2 | Enter an ADI number and a **future** expiry date; upload a badge photo | user | The photo uploads with visible progress |
| 3 | Submit | user | *"Submitted — a moderator will review your ADI evidence."*; status shows **pending** |
| 4 | Sign in as `admin@routesync.uk` → `/admin` | admin | The **Instructors** nav badge has incremented |
| 5 | Open the Instructors panel | admin | The new application is listed with the applicant's name, email, phone, ADI number and expiry |
| 6 | Click **view evidence** | admin | A signed URL opens the badge photo. Copy the URL |
| 7 | Wait > 5 minutes and reopen the copied URL | admin | Access refused — the 300 s TTL has passed |
| 8 | **Approve** with notes | admin | The application leaves the list; the badge count drops |
| 9 | Check the database | — | `instructor_verifications.status = 'verified'` with `reviewed_by`; `contributors.instructor_status = 'verified'` with `verified_at`, `adi_number`, `adi_expiry`; **`users.role = 'instructor'`** |
| 10 | As the applicant, refresh **without** signing out | user | The UI still shows the learner navigation — the role lives in the access token |
| 11 | Sign out and back in | instructor | **Staff** navigation appears; `/contribute/upload` is usable; the "Become an instructor" block is gone |
| 12 | Save an instructor profile with a base postcode and add a slot | instructor | Both succeed |
| 13 | As a learner, search `/instructors/find` from that postcode | user | The new instructor appears in the **nearby** group |

---

## E2E-003 — Record a drive → upload → moderate → publish → watch

| | |
|---|---|
| **Roles** | `admin` (creates the R1), `instructor`, `admin`/`moderator` (moderates), `user` (watches) |
| **Modules crossed** | Reference Routes → Journeys → Uploads → Worker pipeline → Review Queue → Discovery → Playback |
| **Preconditions** | Worker running with `WORKER_SHARED_SECRET` set on **both** API and worker; object storage; a test centre; dashcam video + a GPS log; geolocation available (or use the API path) |

| # | Step | Role | Expected result |
|---|---|---|---|
| 1 | `/admin` → **Reference Routes** → create an R1 for a centre | admin | Created; the success message says contributors can now select it |
| 2 | `/contribute` → **Record a drive**; choose the centre and the R1; **Start** | instructor | A journey starts; fixes accumulate |
| 3 | **Finish** | instructor | A verdict and coverage percentage are returned |
| 4 | Continue to `/contribute/upload` | instructor | Step 1 renders |
| 5 | Step 1: title, the same centre, the same R1, GPS source **"I recorded the GPS in the Test Routify app"**, and the journey from step 3 | instructor | **Next** enables |
| 6 | Step 2: add the front video (and rear, if any) | instructor | **Next** enables |
| 7 | Step 3: review the clip order, gaps and reconciliation; tick the footage agreement | instructor | The reconciliation percentage is shown |
| 8 | Step 4: upload | instructor | Hashing, then per-file upload progress; then complete |
| 9 | Check the state | — | Upload status `queued`; route status `processing` |
| 10 | Wait for the worker | — | `upload_stages` populate; the route reaches **`in_review`** |
| 11 | `/admin` → **Review Queue** | admin | The new route is listed, **first** if `is_instructor` |
| 12 | Open its detail | admin | Quality metrics, pipeline stages and video renditions render; the signed thumbnail loads |
| 13 | **Approve** | admin | Status → `published`, `published_at` set; `approvals` and `audit_log` rows written |
| 14 | Check the contributor's stats | — | Credits increased by **10** (plus any high-quality bonus); `routes_published` incremented |
| 15 | Sign in as a learner → `/discover` and the centre page | user | The new route appears with the instructor byline and a verified badge |
| 16 | Open it and click **Watch** (with entitlement) | user | Video plays; the map marker follows the recorded track; the segment requests go through the **signed HLS gateway** |

**If the pipeline stalls at `queued`:** the worker is not running, or
`WORKER_SHARED_SECRET` is unset — check `POST /api/internal/journeys/analyse-upload` for a
503 before raising a defect.

---

## E2E-004 — Book a lesson: learner → instructor → admin

| | |
|---|---|
| **Roles** | `instructor`, `user`, `admin` |
| **Modules crossed** | Instructor Dashboard → Bookings → Admin Bookings → Notifications |
| **Preconditions** | A verified instructor; `platform_config.booking_fee_pct` at its default of 10 |

| # | Step | Role | Expected result |
|---|---|---|---|
| 1 | `/instructors/me` → set a base postcode, a price of £35.00, accepting bookings on | instructor | Saved |
| 2 | Add an availability slot for tomorrow | instructor | Created |
| 3 | `/instructors/find` → search that postcode | user | The instructor appears in **nearby** with a distance |
| 4 | Open their profile | user | Bio, price, reputation, published routes and the open slot |
| 5 | Book the slot with lesson notes | user | Response: `lessonFee 3500`, `platformFee 350`, `totalAmount 3850`; booking status **`pending`** |
| 6 | Reload the instructor's public profile | user | **The slot is gone** — `is_booked = TRUE` |
| 7 | `/bookings` | user | The booking is listed with date, time, status and amount |
| 8 | Check `booking_payments` | — | One row: 3850 / 3500 / 350, status `pending` |
| 9 | `/instructors/me` | instructor | The booking is listed with the learner's name, the fee breakdown and the notes |
| 10 | `PATCH /api/bookings/<id>` with `{"status":"confirmed"}` | instructor | **200** |
| 11 | `/bookings` | user | Status now `confirmed` |
| 12 | `GET /api/notifications` for both parties | both | Record whether any notification was generated — see `API-012` |
| 13 | `/admin` → **Bookings** | admin | The booking appears with both names, the amount and the platform fee |

---

## E2E-005 — Suspend and reinstate

| | |
|---|---|
| **Roles** | `admin`, plus the suspended user |
| **Modules crossed** | Admin Users → Auth → Bookings/Instructor search |
| **Preconditions** | The target signed in in a second browser, so the live-session behaviour can be observed |

| # | Step | Role | Expected result |
|---|---|---|---|
| 1 | Note the instructor is visible on `/instructors/find` | user | Present |
| 2 | `/admin` → Users → **Suspend** `instructor@routesync.uk` | admin | The pill becomes **Suspended**; an `audit_log` row is written |
| 3 | Try to sign in as that instructor in a fresh browser | — | **401 Account suspended** |
| 4 | Search `/instructors/find` again | user | The instructor is **gone** |
| 5 | In the instructor's **already-open** session, navigate the app | instructor | **Still works** until the access token expires — there is no session revocation on suspension. Record the duration and confirm the severity with the security owner (`EDGE-015`) |
| 6 | Wait for the access token to expire, then act again | instructor | Now blocked |
| 7 | **Reinstate** the account | admin | The pill returns to **Active** |
| 8 | Sign in as the instructor | instructor | Works; they reappear in learner search |

---

## E2E-006 — Test centre lifecycle

| | |
|---|---|
| **Roles** | `admin` / `instructor` |
| **Modules crossed** | Test Centres → postcodes.io → Uploads → Review Queue → Test Centres delete guard |

| # | Step | Role | Expected result |
|---|---|---|---|
| 1 | `/test-centres` → **+ New test centre**, postcode `B25 8JS` | instructor | Town and region pre-fill from the postcode lookup |
| 2 | Save | instructor | Created and listed; searchable by name, town and postcode |
| 3 | Open it | any | Centre detail with an **empty** route list |
| 4 | **Delete** it | instructor | Deleted — no routes reference it |
| 5 | Recreate it, then upload a route to it (E2E-003 steps 4–13) | instructor + admin | The route is published at that centre |
| 6 | Open the centre | user | The published route is listed |
| 7 | Try to **delete** the centre | instructor | **400** — *"This test centre still has routes. Reassign or remove them first."* The centre survives |
| 8 | Try to create a **second** centre with the same name | instructor | Conflict error, not a 500 |

---

## E2E-007 — Password reset invalidates every session

| | |
|---|---|
| **Roles** | any |
| **Modules crossed** | Auth → Mail → Auth again |
| **Preconditions** | **Outbound email configured** — otherwise this workflow cannot be run at all |

| # | Step | Expected result |
|---|---|---|
| 1 | Sign in as the target account in **two** browsers | Both work |
| 2 | In a third, private window, go to `/forgot-password` and submit that address | **202** and a "Check your inbox" screen |
| 3 | Also submit an address that does **not** exist | **Identical** response and screen — any difference is an account-enumeration defect |
| 4 | Open the link from the email | `/reset-password?token=…` renders |
| 5 | Enter a new password twice and submit | "Password changed" |
| 6 | Return to browsers 1 and 2 and trigger a token refresh | Both are signed out — every refresh token was revoked |
| 7 | Sign in with the **old** password | **401 Invalid credentials** |
| 8 | Sign in with the **new** password | Works |
| 9 | Click the reset link again | **401** — it is single-use |
| 10 | Check `users.email_verified` | **true** — completing a reset proves inbox control |

---

## E2E-008 — Cancellation releases the slot

| | |
|---|---|
| **Roles** | two learners, one instructor |
| **Modules crossed** | Bookings → Instructor availability → Bookings again |

| # | Step | Role | Expected result |
|---|---|---|---|
| 1 | Learner A books a slot | user A | Booking created; the slot disappears from the public profile |
| 2 | Learner B opens the same instructor profile | user B | That slot is **not** offered |
| 3 | Learner A cancels the booking | user A | Status `cancelled` |
| 4 | Learner B reloads the profile | user B | The slot is **back** |
| 5 | Learner B books it | user B | Succeeds; a new booking and payment row are created |
| 6 | Learner A opens `/bookings` | user A | Their cancelled booking is still listed as `cancelled` |
| 7 | The instructor opens `/instructors/me` | instructor | Both bookings are visible — one cancelled, one active |
| 8 | The instructor tries to delete the now-booked slot | instructor | **403 Cannot delete a booked slot** |

---

## E2E-009 — Moderator's restricted console journey

| | |
|---|---|
| **Roles** | `moderator` |
| **Modules crossed** | Auth → Admin console (all panels) → main app navigation |
| **Preconditions** | A moderator account created per [12 §3.1](12-TEST-ENVIRONMENT-AND-DATA.md) |

| # | Step | Expected result |
|---|---|---|
| 1 | Sign in as the moderator | Lands **directly on `/admin`** |
| 2 | Approve a route in the Review Queue | **Succeeds** |
| 3 | Approve an ADI application | **Succeeds** — the applicant becomes an `instructor` |
| 4 | Open the Users panel | The list renders |
| 5 | Change a user's role from the panel | **403** (`PERM-019`) — and the control was **not disabled** (PI-06) |
| 6 | Click **Revenue** | **403** (`PERM-018`) — and the nav item was **not hidden** (PI-06) |
| 7 | Try to record a fund payout | **403** |
| 8 | Try to run rev-share attribution | **403** |
| 9 | Click **Main app** | `/test-centres` with the **learner** navigation — no Contribute tab, no + New test centre |
| 10 | Try `POST /api/test-centres` with the moderator token | **403** |
| 11 | Open `/account` | Record what renders — there is no `moderator` branch on that page |
</content>
