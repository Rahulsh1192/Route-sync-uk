# 08 — Regression Checklist

Run this before every release. It is deliberately short enough to complete in one session
and broad enough to catch a break in any major area.

Full coverage lives in the module documents; this is the sweep.

**Accounts needed:** `learner@routesync.uk` · `instructor@routesync.uk` ·
`admin@routesync.uk` · a moderator you created · a **fresh** learner account (for the
free-demo-route checks).

---

## Environment

- [ ] `GET /api/health` returns `{"status":"ok","db":"up"}`
- [ ] `http://localhost:3000/docs` (or `<api>/docs`) renders Swagger
- [ ] The web app loads the branded landing page
- [ ] The seed data is present: ~45 test centres, 4 published routes, 3 queue items, 3 pending ADI applications
- [ ] All migrations through `migrate_phase_28.sql` are applied

---

## Authentication

- [ ] Register a new account with the required fields only
- [ ] Register with the optional contact fields
- [ ] Duplicate email → **409**
- [ ] Password shorter than 8 characters → **400**
- [ ] Sign in as a learner → lands on `/test-centres`
- [ ] Sign in as an instructor → lands on `/test-centres` with **staff** navigation
- [ ] Sign in as an admin → lands **directly on `/admin`**
- [ ] Sign in as a moderator → lands **directly on `/admin`**
- [ ] Wrong password and unknown email give the **same** `401 Invalid credentials`
- [ ] Suspended account → `401 Account suspended`
- [ ] Browser refresh keeps the session
- [ ] Sign out clears the session; Back does not restore protected pages
- [ ] Protected page while signed out → redirected to `/login`
- [ ] Refresh-token rotation: the old token is rejected on reuse
- [ ] **Instructor single session**: a second login evicts the first, with the "used on another device" message
- [ ] `/forgot-password` returns the identical response for a known and an unknown address
- [ ] *(email configured)* Verification link works once, then fails
- [ ] *(email configured)* Reset link works once, revokes every session, and the new password works

---

## Navigation and role landing

- [ ] Learner nav: Test Centres · Discover Routes · Book a Driving Instructor · My Bookings · Account
- [ ] Staff nav: Test Centres · Discover Routes · My Lessons · Contribute · Account
- [ ] Moderator gets the **learner** nav in the main app
- [ ] Below 700 px the bottom tab bar appears and the desktop nav is hidden
- [ ] Learner and instructor navigating to `/admin` are redirected to `/test-centres`
- [ ] An unknown URL redirects to `/` when signed in, `/login` when not

---

## Test Centres

- [ ] The centre list loads with route counts
- [ ] Search by name, town and postcode each work
- [ ] A no-match search shows an empty state, not an error
- [ ] A centre detail page shows only **published** routes
- [ ] Staff see **+ New test centre** and Edit/Delete; learners and moderators do not
- [ ] Create a centre — the postcode lookup pre-fills town and region
- [ ] Duplicate centre name is rejected with a readable message
- [ ] Deleting a centre **with routes** → 400 with the "still has routes" message
- [ ] Deleting an empty centre succeeds

---

## Discovery and search

- [ ] `/discover` lists exactly the published routes
- [ ] Search matches title, instructor name, centre name, town and postcode
- [ ] Instructor routes sort above the rest
- [ ] Unpublished routes are never returned
- [ ] Route cards show **miles**, difficulty, quality and the instructor byline
- [ ] The instructor byline opens `/instructors/:id`

---

## Route access and paywall

- [ ] **Fresh account:** the first route opened plays free
- [ ] **Fresh account:** a second route shows the paywall for its centre
- [ ] Returning to the claimed route still plays
- [ ] Premium for one centre unlocks **every** route at that centre
- [ ] Premium for one centre does **not** unlock another centre
- [ ] The paywall names the correct test centre and shows both plans at the right prices
- [ ] An unpublished route id → 404

---

## Playback and practice

- [ ] The Watch page loads and the front video plays
- [ ] View modes All / Front / Rear / Split / Map all switch **without re-buffering**
- [ ] Map and Rear buttons are hidden when the route lacks the data
- [ ] Seek, play/pause and ±10 s skip all work
- [ ] The map marker follows playback; the follow toggle works
- [ ] Practice mode speaks instructions in UK English; Start / Stop / Restart work
- [ ] Practice reaching the end shows "Route complete"
- [ ] *(worker-processed route)* Segment requests go through the signed HLS gateway
- [ ] *(worker-processed route)* A token from route A is rejected on route B

---

## Bookings

- [ ] Instructor search with no filters returns verified instructors
- [ ] Postcode search returns `nearby` (or `elsewhere` when there is no local coverage)
- [ ] The max-price filter excludes more expensive instructors
- [ ] An instructor profile shows only **future, unbooked** slots
- [ ] Booking a slot returns the correct lesson fee, platform fee and total
- [ ] The booked slot disappears from the public profile
- [ ] The booking appears on `/bookings`, on `/instructors/me` and in the admin Bookings panel
- [ ] Cancelling releases the slot
- [ ] A learner cannot update another learner's booking

---

## Instructor dashboard

- [ ] `/instructors/me` shows the profile, slots and received bookings
- [ ] Saving the profile persists; a **partial** update does not wipe other fields
- [ ] Adding a slot works; a duplicate is rejected with 409
- [ ] Deleting an unbooked slot works; deleting a **booked** slot is refused
- [ ] Setting a base postcode moves the instructor into `nearby` search results
- [ ] An **admin** calling `/api/instructors/me/*` gets **403**

---

## Instructor verification

- [ ] A learner sees "Become an instructor"; staff do not
- [ ] Submitting with a valid ADI number, a future expiry and a badge photo works
- [ ] An **expired** expiry date is rejected
- [ ] A **duplicate** ADI number is rejected with 409, not 500
- [ ] An unsupported file type and an oversized file are both rejected
- [ ] A second application while one is pending → 409

---

## Contribute and uploads

- [ ] The Contribute tab is visible to staff only
- [ ] `/contribute` shows the gated message for learners
- [ ] The upload wizard's four steps validate as expected
- [ ] Reference routes are filtered by the chosen test centre
- [ ] Step 3 shows the clip order, gaps and reconciliation, and requires the agreement
- [ ] Upload progress shows separate hashing and transfer phases
- [ ] A re-uploaded identical file is **deduplicated** and not transferred
- [ ] Completing an upload sets it to `queued` and the route to `processing`
- [ ] Aborting a `queued`/`processing` upload is refused
- [ ] One instructor cannot read, complete or abort another's upload

---

## Journeys and reference routes

- [ ] An admin can create a reference route; fewer than 2 points is rejected
- [ ] A new R1 appears in the upload wizard and on Record a drive for its centre
- [ ] An on-route synthetic track submits as `verified`
- [ ] An off-route or partial track submits as `rejected`
- [ ] The same track submitted twice gives an **identical** verdict
- [ ] `POST /api/internal/journeys/analyse-upload` with no worker secret → 403/503

---

## Admin console

- [ ] The console loads on Review Queue with correct nav badges and stat tiles
- [ ] The queue shows only `in_review`/`flagged`, instructor routes first
- [ ] Approving publishes the route, awards contributor credits and writes `approvals` + `audit_log`
- [ ] The approved route becomes visible to learners
- [ ] Rejecting removes it from learner surfaces
- [ ] The Users panel searches by email, name and **phone with formatting stripped**
- [ ] An admin can change a role and suspend/reinstate; both are audited
- [ ] The Instructors panel lists pending applications with expiry flags
- [ ] Badge evidence opens via a **signed, short-lived** URL
- [ ] Approving an ADI application sets `users.role = 'instructor'`
- [ ] The Bookings panel lists all bookings with both parties and the commission
- [ ] Revenue, Community Fund, Instructor Earnings and Reports panels all load for an admin
- [ ] Fund: adding a beneficiary, allocating and paying out all work; a payout above the balance is refused
- [ ] Fund and rev-share runs are **idempotent** per period

---

## Roles and permissions

- [ ] A learner gets **403** on: `/api/admin/*`, `/api/test-centres` writes, `/api/uploads`, `/api/reference-routes`, `/api/journeys`, `/api/instructors/me/*`
- [ ] A learner **cannot** self-promote via `PATCH /api/admin/users/:id`
- [ ] An instructor **cannot** approve their own route
- [ ] An instructor **cannot** verify their own ADI application
- [ ] A moderator gets **403** on: revenue, user writes, all fund writes, the revshare run, test-centre writes, uploads, journeys
- [ ] An admin gets **403** on the `@Roles('instructor')` availability endpoints
- [ ] One user cannot read another's uploads, journeys, bookings, progress or notifications

---

## Error handling

- [ ] With the API stopped, every list page shows a readable error — no blank pages, no endless spinners
- [ ] A 500 response body contains **no** stack trace, SQL or file paths
- [ ] The Stripe webhook rejects an unsigned request with 400
- [ ] Registration still succeeds when email is unconfigured
- [ ] Test-centre creation returns a readable 503 when postcodes.io is unreachable
- [ ] Entered form data is preserved after a failed save

---

## Responsive and accessibility

- [ ] 375 px: bottom tab bar, 1-column grid, all pages usable
- [ ] 700 px: the nav switches cleanly with no overlap
- [ ] 960 px+: 3-column test-centre grid
- [ ] Admin tables scroll within their container on mobile, not the whole page
- [ ] **Light mode** (OS setting) is readable everywhere, including muted text and pills
- [ ] **Reduce motion** (OS setting) suppresses animations
- [ ] Keyboard-only: sign in, navigate, open a route, start playback
- [ ] Every focused element shows a visible focus ring
- [ ] An axe/Lighthouse pass on the key pages shows no **new** violations since the last release

---

## Sign-off

| Field | |
|---|---|
| Release / build | |
| Environment (local / deployed) | |
| Tester | |
| Date | |
| Items passed / total | |
| Blocking defects raised | |
| Non-blocking defects raised | |
| Items skipped (and why) | |
</content>
