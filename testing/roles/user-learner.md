# Role — `user` (Learner)

**Prefix:** `ROLE-USR-###`

> *"If I sign in as a learner, what exactly should I be able to do?"*

**Test account:** `learner@routesync.uk` · password as documented in
[12-TEST-ENVIRONMENT-AND-DATA.md](../12-TEST-ENVIRONMENT-AND-DATA.md)
**Role value:** `user` — the default for every new registration.

---

## 1. Expected navigation

**Post-login landing:** `/test-centres`.

| Desktop header | Mobile bottom bar (viewport < 700 px) |
|---|---|
| Test Centres · Discover Routes · Book a Driving Instructor · My Bookings · Account | Test Centres · Discover · Book a Lesson · Account |

**Must NOT be present:** a **Contribute** tab, a **My Lessons** tab, any link to `/admin`.

---

## 2. Accessible modules

| Module | What the learner can do |
|---|---|
| Test Centres | Browse, search, open a centre and see its published routes |
| Discovery | Global search across published routes |
| Route detail | View metadata and the access decision |
| Watch / Practice | Open **one** free route (permanently claimed), or any route at a centre they hold Premium for |
| Subscriptions | See plans, start Stripe checkout for a specific centre |
| Bookings | Search instructors, view profiles and slots, book, view and cancel their own bookings |
| Account | Edit display name and contact details, clear contact details, request GDPR export/erasure, sign out |
| Progress | View their own progress and route history |
| Instructor verification | Apply to become an instructor |
| Community | View badges, leaderboards and contributor profiles (API only) |
| Offline | **Only with Premium** (API only) |
| Notifications | Their own (API only) |

---

## 3. Allowed actions

View · Search · Filter · Watch · Practise · Purchase · Book · Cancel (own booking) ·
Edit (own profile) · Delete (own contact details, own account) · Apply (as an instructor) ·
Upload (badge evidence only).

---

## 4. Restricted features and actions

| Restricted | Expected outcome |
|---|---|
| Admin console `/admin` | Redirected to `/test-centres` |
| Create / edit / delete a test centre | **403 Insufficient role** at API level. **The form page still renders if typed as a URL** |
| Postcode lookup helper | **403** |
| Start an upload, sign parts, complete, abort, attach video | **403** |
| Create a reference route | **403** |
| Start / check / submit a journey | **403** |
| Manage an instructor profile, availability or received bookings | **403** |
| Any `/api/admin/*` endpoint | **403** |
| Read another user's uploads, journeys, bookings, progress or notifications | **403** or an empty result |
| Watch a second route without Premium | **403** / redirected to the paywall |
| Request an offline package without Premium | **403** |

---

## 5. Expected data visibility

Only: published routes; their own subscription; their own bookings; their own progress and
history; their own uploads (none); their own offline packages and notifications; **public**
contributor profiles, badges, leaderboards and fund figures.

**Never:** another learner's bookings or progress · another user's contact details ·
unpublished routes · ADI badge evidence · the review queue · revenue or fund write
operations.

---

## 6. Role walkthrough

| Test ID | Step | Expected Result |
|---|---|---|
| ROLE-USR-001 | Sign in as `learner@routesync.uk` | Lands on `/test-centres` |
| ROLE-USR-002 | Inspect the desktop navigation | Exactly the five learner items. **No Contribute, no My Lessons** |
| ROLE-USR-003 | Resize below 700 px | The bottom tab bar appears with the four learner tabs; the desktop nav is hidden |
| ROLE-USR-004 | Open every visible nav item in turn | Each page loads without error |
| ROLE-USR-005 | Open `/account` | The **Become an instructor** block is present; the staff shortcuts are **not** |
| ROLE-USR-006 | Open a route and watch it (first time) | Plays — the free demo claim |
| ROLE-USR-007 | Open a **different** route and try to watch | Paywall for that route's centre |
| ROLE-USR-008 | Search for and open an instructor profile | Profile, routes and available slots render |
| ROLE-USR-009 | Book a slot | Booking created with the fee breakdown, and it appears on `/bookings` |

---

## 7. Negative access tests

Run each at **UI**, **route** and **API** level.

| Test ID | Attempt | Level | Expected Result |
|---|---|---|---|
| ROLE-USR-010 | Look for a Contribute tab | UI | Absent |
| ROLE-USR-011 | Look for **+ New test centre** on `/test-centres` | UI | Absent |
| ROLE-USR-012 | Look for Edit/Delete on a centre detail page | UI | Absent |
| ROLE-USR-013 | Navigate to `/admin` | Route | Redirected to `/test-centres` |
| ROLE-USR-014 | Navigate to `/test-centres/new` | Route | **The page renders.** Saving fails with 403. Confirm the message is readable |
| ROLE-USR-015 | Navigate to `/contribute` | Route | Renders the "verified instructors only" message, not the upload button |
| ROLE-USR-016 | Navigate to `/contribute/upload` | Route | Same gated message |
| ROLE-USR-017 | Navigate to `/instructors/me` | Route | Renders, then the data calls fail with 403. Confirm it degrades readably |
| ROLE-USR-018 | `GET /api/admin/review-queue` | API | **403** |
| ROLE-USR-019 | `GET /api/admin/users` | API | **403** |
| ROLE-USR-020 | **`PATCH /api/admin/users/<own id>` with `{"role":"admin"}`** | API | **403** — a 200 is a **critical privilege-escalation defect** |
| ROLE-USR-021 | `POST /api/test-centres` | API | **403** |
| ROLE-USR-022 | `DELETE /api/test-centres/<id>` | API | **403** |
| ROLE-USR-023 | `POST /api/uploads` | API | **403** |
| ROLE-USR-024 | `POST /api/reference-routes` | API | **403** |
| ROLE-USR-025 | `POST /api/journeys` | API | **403** |
| ROLE-USR-026 | `PUT /api/instructors/me/profile` | API | **403** |
| ROLE-USR-027 | `POST /api/instructors/me/slots` | API | **403** |
| ROLE-USR-028 | `GET /api/instructors/me/bookings` | API | **403** |
| ROLE-USR-029 | **`GET /api/routes/<unclaimed route>/playback`** | API (data) | **403** — a 200 with stream URLs is a **critical revenue defect** |
| ROLE-USR-030 | `GET /api/routes/<unclaimed route>/track` | API (data) | **403** |
| ROLE-USR-031 | **`PATCH /api/bookings/<another learner's booking>`** | API (data) | **403 Not authorised to update this booking** |
| ROLE-USR-032 | `GET /api/uploads/<another user's upload id>` | API (data) | **403 Not your upload** |
| ROLE-USR-033 | `GET /api/journeys/<another user's journey id>` | API (data) | **403 Not your journey** |
| ROLE-USR-034 | `POST /api/routes/<id>/offline` on a free plan | API | **403** |
| ROLE-USR-035 | `PATCH /api/users/me` with `{"role":"admin"}` | API | **400** — unknown property rejected by the validation pipe |
| ROLE-USR-036 | `GET /api/admin/revenue` | API | **403** |
| ROLE-USR-037 | `POST /api/admin/instructors/<id>/verify` | API | **403** |
| ROLE-USR-038 | `POST /api/internal/journeys/analyse-upload` (no worker secret) | API | **403** or **503** — never a success |
</content>
