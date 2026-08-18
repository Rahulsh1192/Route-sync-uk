# Role — `instructor` (Verified ADI)

**Prefix:** `ROLE-INS-###`

> *"If I sign in as an instructor, what exactly should I be able to do?"*

**Test account:** `instructor@routesync.uk` — "Sarah Johnson (ADI)", `instructor_status =
verified`, ADI `ADI12345`, lesson price £35.00, 7 availability slots.

---

## 1. Expected navigation

**Post-login landing:** `/test-centres` — **not** the admin console.

| Desktop header | Mobile bottom bar |
|---|---|
| Test Centres · Discover Routes · **My Lessons** · **Contribute** · Account | Test Centres · Discover · **Contribute** · Account |

**Must NOT be present:** any link to `/admin`.

> Note the asymmetry: **My Lessons** is in the desktop nav but **not** in the mobile tab
> bar. Reaching `/instructors/me` on a phone requires the Account page. Worth raising as a
> usability observation — `ROLE-INS-004`.

---

## 2. Accessible modules

Everything a learner can do, **plus**:

| Module | Instructor capability |
|---|---|
| Test Centres | **Create, edit and delete** centres; postcode lookup helper |
| Contribute / Uploads | Start an upload, sign multipart parts, complete, abort, attach video to a map-only route |
| Reference Routes | **Create** an R1 (via the API — the only UI is inside the admin console, which they cannot reach) |
| Record a Drive | Start, live-check and submit a journey; list their own journeys |
| Instructor Dashboard | Edit their own bookable profile; add, list and delete their own availability slots; see the bookings made with them |
| Bookings | Update the status of a booking they are party to |
| Community | Contributor credits, reputation, badges; accept the footage agreement |

---

## 3. Allowed actions

View · Search · Create · Edit · Delete (test centres, own slots, own uploads) ·
Upload · Execute (journeys, conformance submit) · Configure (own instructor profile) ·
Watch / Practise (entitlement-gated **exactly like a learner**) · Book a lesson.

---

## 4. Restricted features and actions

| Restricted | Expected outcome |
|---|---|
| Admin console `/admin` | Redirected to `/test-centres` |
| Review queue, moderation, users, revenue, fund, earnings, reports | **403** on every `/api/admin/*` endpoint |
| **Approve their own route** | **403** — this is the integrity control that stops self-publishing |
| **Verify their own ADI application** | **403** |
| Another instructor's uploads, journeys, slots or bookings | **403** (`Not your upload` / `Not your journey` / 404 on the slot) |
| Watch a second route without Premium | **403** / paywall — contributing does not grant viewing rights |
| Delete a **booked** availability slot | **403 Cannot delete a booked slot** |
| More than 3 uploads a month on a free plan | **403 Free upload limit reached (3/month)** |

---

## 5. Special restriction — single active session

`enforceSingleSessionIfInstructor()` revokes **all** other refresh tokens on every
instructor login, on both the password and OAuth paths. This applies **only** to the
`instructor` role.

---

## 6. Expected data visibility

Published routes · **their own** uploads, journeys, availability slots and received
bookings · their own contributor stats · public contributor profiles, badges and
leaderboards · every test centre (including ones they did not create — there is **no
ownership model** on test centres).

**Never:** another instructor's uploads/journeys/slots/bookings · the review queue ·
user management · revenue or fund figures beyond the public transparency endpoints ·
ADI badge evidence.

---

## 7. Role walkthrough

| Test ID | Step | Expected Result |
|---|---|---|
| ROLE-INS-001 | Sign in as `instructor@routesync.uk` | Lands on `/test-centres` |
| ROLE-INS-002 | Inspect the desktop navigation | Test Centres · Discover Routes · **My Lessons** · **Contribute** · Account |
| ROLE-INS-003 | Open `/account` | **My lessons** and **Contribute** shortcuts; **no** "Become an instructor" block |
| ROLE-INS-004 | Resize below 700 px | Bottom tabs: Test Centres · Discover · Contribute · Account. **My Lessons is absent** — record the usability gap |
| ROLE-INS-005 | Open `/test-centres` | The **+ New test centre** button is present |
| ROLE-INS-006 | Open a centre detail page | **Edit** and **Delete** buttons are present |
| ROLE-INS-007 | Open `/contribute` | Credits / Reputation / Published stats plus **Upload a route** and **Record a drive** |
| ROLE-INS-008 | Open `/instructors/me` | Profile form, availability slots and the received-bookings list all render with real data |
| ROLE-INS-009 | Add an availability slot | Created and visible to learners on the public profile |
| ROLE-INS-010 | Start the upload wizard | Step 1 renders with the test-centre and GPS-source controls |
| ROLE-INS-011 | Watch a route | **Entitlement-gated like a learner** — one free demo route, then the paywall |

---

## 8. Negative access tests

| Test ID | Attempt | Level | Expected Result |
|---|---|---|---|
| ROLE-INS-012 | Look for an admin link in the nav | UI | Absent |
| ROLE-INS-013 | Navigate to `/admin` | Route | Redirected to `/test-centres` |
| ROLE-INS-014 | `GET /api/admin/review-queue` | API | **403** |
| ROLE-INS-015 | **`POST /api/admin/routes/<own route>/moderate` `{"decision":"approve"}`** | API | **403** — a 200 would let a contributor self-publish. **Critical** |
| ROLE-INS-016 | **`POST /api/admin/instructors/<own application>/verify`** | API | **403** — self-verification would bypass the ADI check. **Critical** |
| ROLE-INS-017 | `GET /api/admin/users` | API | **403** |
| ROLE-INS-018 | `PATCH /api/admin/users/<own id>` with `{"role":"admin"}` | API | **403** |
| ROLE-INS-019 | `GET /api/admin/revenue` | API | **403** |
| ROLE-INS-020 | `GET /api/admin/bookings` | API | **403** |
| ROLE-INS-021 | `GET /api/uploads/<another instructor's upload>` | API (data) | **403 Not your upload** |
| ROLE-INS-022 | `POST /api/uploads/<another instructor's upload>/complete` | API (data) | **403** |
| ROLE-INS-023 | `DELETE /api/uploads/<another instructor's upload>` | API (data) | **403** |
| ROLE-INS-024 | `GET /api/journeys/<another instructor's journey>` | API (data) | **403 Not your journey** |
| ROLE-INS-025 | `POST /api/journeys/<another instructor's journey>/submit` | API (data) | **403** |
| ROLE-INS-026 | `DELETE /api/instructors/me/slots/<another instructor's slot>` | API (data) | **404 Slot not found** |
| ROLE-INS-027 | `GET /api/instructors/me/bookings` with two instructors in the system | API (data) | Only **their own** bookings |
| ROLE-INS-028 | `GET /api/routes/<unclaimed route>/playback` with no Premium | API | **403** |
| ROLE-INS-029 | Delete the seeded **booked** slot | API | **403 Cannot delete a booked slot** |
| ROLE-INS-030 | Start a 4th upload in a month on a free plan | API | **403 Free upload limit reached (3/month)** |
| ROLE-INS-031 | **Single session** — sign in from a second browser, then use the first | Behaviour | The first session is invalidated; the login page shows *"You were signed out because your account was used on another device."* |
| ROLE-INS-032 | **Delete a test centre they did not create** | API | **Succeeds** if the centre has no routes — there is **no ownership model** on test centres. Confirm and raise as `Potential Issue` (see [13](../13-TESTING-GAPS.md)) |
</content>
