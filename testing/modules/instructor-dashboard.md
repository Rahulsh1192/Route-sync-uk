# Module — Instructor Dashboard ("My Lessons")

**Prefix:** `INST-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | A verified ADI's own workspace: edit the bookable profile, publish availability slots, and see the lessons learners have booked. |
| **Web path** | `/instructors/me` |
| **Entry point** | "My Lessons" in the staff desktop nav; the **My lessons** button on `/account` |
| **API** | `PUT /api/instructors/me/profile` · `GET`/`POST /api/instructors/me/slots` · `DELETE /api/instructors/me/slots/:slotId` · `GET /api/instructors/me/bookings` |
| **Roles** | **`instructor` only** — `@Roles('instructor')`. **`admin` and `moderator` are excluded**, so an admin calling these gets 403 |
| **Components** | [InstructorDashboardPage.tsx](../../apps/web/src/pages/InstructorDashboardPage.tsx) |
| **Backend** | [bookings.controller.ts](../../apps/api/src/modules/bookings/bookings.controller.ts) · [bookings.service.ts](../../apps/api/src/modules/bookings/bookings.service.ts) |
| **Dependencies** | **postcodes.io** (base postcode is geocoded on save) · the Bookings module consumes the slots |

---

## Preconditions

- Signed in as `instructor@routesync.uk` (role `instructor`, `instructor_status = verified`).
- postcodes.io reachable for the base-postcode tests.

---

## Business rules found in the implementation

1. **The endpoints are `instructor`-exclusive.** Not admin, not moderator.
2. **Profile save is an upsert with `COALESCE` semantics** — omitting a field from a
   partial update leaves the stored value alone. The one exception is
   `is_accepting_bookings`, which is written unconditionally.
3. **Defaults applied on first save:** `lesson_price_minor` **3500** (£35.00),
   `travel_radius_km` **16**, `is_accepting_bookings` **true**.
4. **The base postcode is geocoded on save.** Without one, the instructor can never appear
   in a `nearby` search result — only in `elsewhere`.
5. **`travel_radius_km` is validated 1–100**, and independently capped at **40 km** at
   search time.
6. **`lesson_price_minor` has a minimum of 0**, not a floor — pricing is the instructor's
   decision.
7. **Duplicate slot rejected:** the same `instructor_id` + `slot_date` + `start_time`
   returns **409 Slot already exists**.
8. **A booked slot cannot be deleted** — **403 Cannot delete a booked slot**.
9. **`GET /api/instructors/me/slots`** returns slots from today onward (or from an
   optional `?from=` date), **including** booked ones — unlike the public slot list.
10. **Route ordering matters.** `instructors/me/...` routes are declared **before**
    `instructors/:id/...`. If a request for `/api/instructors/me/slots` ever returns a
    500 about an invalid UUID `'me'`, that ordering has regressed — see `INST-018`.

---

## UI components

H1 "My lessons" · a **Find an instructor** button when the profile is empty · profile
form (bio, years of experience, lesson price, accepting-bookings toggle, base postcode,
travel radius) with a save button · an **add slot** form (date, start time, end time) with
validation and an add button · the slot list with a **Remove** action (not offered on
booked slots) · the received-bookings list (learner name and avatar, date/time, status,
fee breakdown, lesson notes).

---

## Functional test cases

### Profile

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| INST-001 | Dashboard loads | instructor | Seeded | Nav → **My Lessons** | `/instructors/me` renders the profile form, the slot list and the bookings list |
| INST-002 | Existing profile is pre-filled | instructor | Seeded profile | Open the page | Bio, 12 years, **£35.00**, accepting bookings = on |
| INST-003 | Edit the bio and price | instructor | — | Change the bio and set the price to £40.00 → Save | Saved; persists after refresh; the new price appears on the public profile and in search results |
| INST-004 | Set the base postcode | instructor | postcodes.io reachable | Enter `NW7 1RB` → Save | Saved and geocoded. A learner searching `NW7 1RB` now finds this instructor in **`nearby`** (BOOK-004) |
| INST-005 | Turn off accepting bookings | instructor | — | Untick **accepting bookings** → Save | Saved. The instructor disappears from learner search (BOOK-011) |
| INST-006 | **Partial update does not wipe other fields** | instructor | Base postcode and bio both set | `PUT /api/instructors/me/profile` with **only** `{"lessonPriceMinor":4000}` | Price changes; **base postcode, bio, years and radius are unchanged**. Losing the postcode here would silently drop the instructor from every local search |
| INST-007 | Invalid base postcode | instructor | — | Enter `ZZ99 9ZZ` → Save | A readable error; nothing saved |
| INST-008 | Travel radius above the maximum | instructor | — | `PUT` with `{"travelRadiusKm":150}` | **400** (max 100) |
| INST-009 | Travel radius below the minimum | instructor | — | `PUT` with `{"travelRadiusKm":0}` | **400** (min 1) |
| INST-010 | Negative price | instructor | — | `PUT` with `{"lessonPriceMinor":-100}` | **400** (min 0) |
| INST-011 | Zero price | instructor | — | `PUT` with `{"lessonPriceMinor":0}` | **Accepted** — 0 is a valid price. Confirm the booking then costs only the platform fee |
| INST-012 | Negative years of experience | instructor | — | `PUT` with `{"yearsExperience":-1}` | **400** (min 0) |
| INST-013 | Overlong base postcode | instructor | — | `PUT` with a 20-character postcode | **400** (max 12) |

### Availability

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| INST-014 | Existing slots are listed | instructor | Seeded slots | Open `/instructors/me` | The 7 seeded slots for `CURRENT_DATE + 1…+5` are listed, in date and time order |
| INST-015 | Add a slot | instructor | — | Date = tomorrow, 15:00–16:00 → Add | Slot created and listed; a learner sees it on the public profile |
| INST-016 | **Duplicate slot** | instructor | A slot already exists at that date and start time | Add the same date + start time again | **409 Slot already exists**; no duplicate row |
| INST-017 | Delete an unbooked slot | instructor | An unbooked slot | Click Remove | Slot deleted and gone from the public profile |
| INST-018 | **Delete a booked slot** | instructor | The seeded booked slot | Attempt to delete it | **403 Cannot delete a booked slot**. The UI should not offer the button at all — if it does and the API refuses, note both |
| INST-019 | Delete another instructor's slot | instructor | A slot id belonging to a different instructor | `DELETE /api/instructors/me/slots/<other id>` | **404 Slot not found** — ownership is enforced by the query |
| INST-020 | **`me` route resolves correctly** | instructor | — | `GET /api/instructors/me/slots` | **200** with a slot array. A **500** mentioning an invalid UUID `'me'` means the `me/…` routes are being matched by `:id/…` — a route-ordering regression |
| INST-021 | Slots from a given date | instructor | Slots across several days | `GET /api/instructors/me/slots?from=<date+3>` | Only slots on or after that date |
| INST-022 | Own slot list includes booked slots | instructor | Seeded booked slot | `GET /api/instructors/me/slots` | The booked slot **is** present (unlike the public list) and is marked as booked |
| INST-023 | Add a slot in the past | instructor | — | Add a slot dated yesterday | Record the result. **No past-date validation exists in the code** — if it is accepted, confirm it stays invisible to learners and raise as `Potential Issue` |
| INST-024 | End time before start time | instructor | — | Add 16:00–15:00 | Record the result. **No ordering validation exists** — raise as `Potential Issue` if accepted |
| INST-025 | Malformed time | instructor | — | `POST` with `{"startTime":"25:99"}` | The value reaches a `time` column cast. Expect a database error surfacing as **500** — record the exact code (`Potential Issue`) |
| INST-026 | Malformed date | instructor | — | `POST` with `{"slotDate":"not-a-date"}` | **400** — `@IsDateString()` catches this one |

### Received bookings and authorisation

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| INST-027 | Received bookings are listed | instructor | Seeded booking | Open `/instructors/me` | The learner's name, date/time, status, and the `lesson_fee` / `platform_fee` / total breakdown are shown |
| INST-028 | Lesson notes are visible | instructor | BOOK-022 done | Open the bookings list | The learner's notes are shown |
| INST-029 | **Data scope** | instructor | Two instructors, each with bookings | `GET /api/instructors/me/bookings` as instructor A | Only A's bookings. Any of B's is a **critical data-leak defect** |
| INST-030 | Instructor confirms a booking | instructor | A `pending` booking | `PATCH /api/bookings/<id>` with `{"status":"confirmed"}` | **200**; the learner sees the new status on `/bookings` |
| INST-031 | **Admin is denied** | admin | Admin token | `PUT /api/instructors/me/profile`, then `GET /api/instructors/me/slots` | **403 Insufficient role** on both — `@Roles('instructor')` is exclusive. Note that the web app still shows "My Lessons"-style links for admins, so the page will render and then fail |
| INST-032 | **Moderator is denied** | moderator | Moderator token | Same calls | **403** |
| INST-033 | **Learner is denied** | user | Learner token | Same calls | **403** |
| INST-034 | Learner opens `/instructors/me` in the browser | user | — | Type the URL | The page renders (no client-side guard) and the data calls fail. Confirm a readable message rather than a broken layout |
| INST-035 | Unauthenticated | — | No token | `GET /api/instructors/me/slots` | **401** |

---

## Traceability

| Test IDs | UI | API | Guard | Logic |
|---|---|---|---|---|
| INST-001 … INST-013 | profile form | `PUT /api/instructors/me/profile` | `@Roles('instructor')` | `updateMyProfile()`, `PostcodeService.require()` |
| INST-014 … INST-026 | slot form and list | `GET`/`POST`/`DELETE /api/instructors/me/slots` | `@Roles('instructor')` | `getMySlots()`, `addSlot()`, `deleteSlot()` |
| INST-027 … INST-030 | bookings list | `GET /api/instructors/me/bookings` | `@Roles('instructor')` | `getInstructorBookings()` |
| INST-031 … INST-035 | — | all of the above | `RolesGuard` | — |
</content>
