# Module — Bookings (Learner Side)

**Prefix:** `BOOK-###`

The instructor's half of this module is in
[instructor-dashboard.md](instructor-dashboard.md); the admin's view is in
[admin-bookings.md](admin-bookings.md).

---

## Module overview

| | |
|---|---|
| **Purpose** | A learner finds a verified driving instructor, picks an available slot, and books a lesson. The platform adds a commission on top of the instructor's price. |
| **Web paths** | `/instructors/find` · `/instructors/:id` · `/bookings` |
| **Entry point** | "Book a Driving Instructor" / "My Bookings" in the learner nav; also from an instructor byline on a route card, and the call to action on the practice page |
| **API** | `GET /api/instructors?postcode=&maxPrice=&page=` · `GET /api/instructors/:id/profile` · `GET /api/instructors/:id/slots` · `POST /api/bookings` · `GET /api/bookings/mine` · `PATCH /api/bookings/:id` |
| **Roles** | Every authenticated role can search and book |
| **Components** | [FindInstructorsPage.tsx](../../apps/web/src/pages/FindInstructorsPage.tsx) · [InstructorProfilePage.tsx](../../apps/web/src/pages/InstructorProfilePage.tsx) · [BookingsPage.tsx](../../apps/web/src/pages/BookingsPage.tsx) |
| **Backend** | [bookings.controller.ts](../../apps/api/src/modules/bookings/bookings.controller.ts) · [bookings.service.ts](../../apps/api/src/modules/bookings/bookings.service.ts) · [postcode.service.ts](../../apps/api/src/modules/geo/postcode.service.ts) |
| **Dependencies** | Instructor verification (only `verified` instructors appear) · instructor availability slots · `platform_config.booking_fee_pct` · **postcodes.io** for proximity search |

---

## Preconditions

- Signed in as a learner.
- At least one **verified** instructor exists with **future, unbooked** availability slots.
  The seed provides `instructor@routesync.uk` with 7 slots on `CURRENT_DATE + 1…+5`.
- **The seeded instructor has no base postcode**, so a postcode search returns them in the
  `elsewhere` group, never `nearby`. To test the `nearby` path, set a base postcode first
  (`INST-004`).

## Test data

| Item | Value |
|---|---|
| Verified instructor | `instructor@routesync.uk` — "Sarah Johnson (ADI)", 12 years, **£35.00** per lesson |
| Existing booking | `learner@routesync.uk` ↔ Sarah Johnson, status `confirmed`, first seeded slot |
| Postcode to search from | `NW7 1RB` (Mill Hill), `B25 8JS` (Birmingham) |

---

## Business rules found in the implementation

1. **An instructor is only listed when all of these hold:** `users.role = 'instructor'`,
   `contributors.instructor_status = 'verified'`, `users.is_suspended = FALSE`, and
   `instructor_profiles.is_accepting_bookings` is `TRUE` **or NULL**.
2. **Two result groups.** `nearby` = within the instructor's own `travel_radius_km`
   (default 16 km), **capped at 40 km** whatever the profile says.
   `elsewhere` is populated **only when `nearby` is empty**, so a distant instructor is
   never mixed in as if they were local.
3. **Instructors with no base location can never be `nearby`** — they always appear in
   `elsewhere`, ranked last.
4. **A postcode search never silently degrades.** If postcodes.io cannot resolve the
   postcode, the request fails rather than returning a nationwide list.
5. **With no postcode** the search returns a nationwide list ordered by
   `reputation DESC, lesson_price_minor ASC`, page size **20**.
6. **Pricing:** `lesson_fee` = the instructor's `lesson_price_minor` (default **3500**
   = £35.00); `platform_fee` = `round(lesson_fee × booking_fee_pct / 100)` with
   `booking_fee_pct` from `platform_config`, default **10**; `total = lesson_fee +
   platform_fee`. Creating a booking also writes a `booking_payments` row with status
   `pending`.
7. **Booking a slot flips `availability_slots.is_booked` to TRUE**, so it disappears from
   the public slot list.
8. **Only future, unbooked slots** are returned by `GET /api/instructors/:id/slots`.
9. **Cancelling a booking frees the slot** (`is_booked` back to `FALSE`).
10. **Who may change a booking:** the learner, the instructor, **or** any `admin`/
    `moderator`. Anyone else gets **403**.
11. `booking_status` values are `pending`, `confirmed`, `cancelled`, `completed`,
    `no_show`. A new booking is created with the column default **`pending`**.
12. **`PATCH /api/bookings/:id` validates `status` only with `@IsString()`** — there is no
    `@IsIn(...)`, and no restriction on which party may make which transition. See
    `BOOK-035` and `BOOK-036`.

---

## UI components

| Screen | Elements |
|---|---|
| `/instructors/find` | H1 "Book a driving instructor" · **postcode** input (`placeholder="e.g. B25 8JS"`) · **max price** number input (`placeholder="e.g. 40"`, `step=1`) · Search button (disabled while loading) · results list showing name, avatar, bio, years, price, reputation, distance · a "covers other areas" section for `elsewhere` results · error banner · empty state |
| `/instructors/:id` | Instructor profile, their published routes, the centres they cover, available slots, and a **Book** button |
| `/bookings` | H1 "My Bookings" · booking cards (date, time, instructor name and avatar, status, amount, payment status) · a **Cancel** button on cancellable bookings · error banner · empty state |

---

## Functional test cases

### Finding an instructor

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| BOOK-001 | Instructor search page loads | user | — | Nav → **Book a Driving Instructor** | `/instructors/find` renders with both filter inputs |
| BOOK-002 | Search with no filters | user | — | Submit with empty fields | The nationwide list is returned, ordered by reputation then price. Sarah Johnson appears |
| BOOK-003 | Search by postcode — no local instructors | user | Seeded instructor has no base postcode | Search `B25 8JS` | Results come back under the **"covers other areas"** (`elsewhere`) grouping, not as local matches. **Expected behaviour** |
| BOOK-004 | Search by postcode — local instructor | user | Set the instructor's base postcode to `NW7 1RB` first (`INST-004`) | Search `NW7 1RB` | Sarah Johnson appears in **`nearby`** with a distance close to 0 km |
| BOOK-005 | Radius cap | user | Set the instructor's `travel_radius_km` to 100 and base postcode `NW7 1RB` | Search from a postcode ~60 km away | They are **not** `nearby` — the 40 km cap applies regardless of the stated radius |
| BOOK-006 | Filter by max price | user | Instructor price is £35.00 | Search with max price **30** | Sarah Johnson is excluded. Search with **40** → included |
| BOOK-007 | Invalid postcode | user | — | Search `ZZ99 9ZZ` | A readable error; the request is **not** silently converted into a nationwide list |
| BOOK-008 | postcodes.io unreachable | user | Block the service | Search with any postcode | A readable error, not a nationwide list masquerading as local results |
| BOOK-009 | Unverified instructor is not listed | user | Set `contributors.instructor_status` to `pending` for the seeded instructor | Search | They disappear from the results |
| BOOK-010 | Suspended instructor is not listed | admin then user | Suspend the instructor account | Search | They disappear |
| BOOK-011 | Instructor not accepting bookings | instructor then user | Instructor sets **accepting bookings** to off (`INST-005`) | Search | They disappear |
| BOOK-012 | Pagination | user | Needs > 20 verified instructors | `GET /api/instructors?page=0` then `?page=1` | 20 per page; page 1 continues where page 0 stopped |
| BOOK-013 | Open an instructor profile | user | — | Click a result | `/instructors/:id` shows bio, years, price, reputation, their published routes and the centres they cover |
| BOOK-014 | Profile of a **non-verified** instructor | user | Know a pending applicant's user id | Open `/instructors/<that id>` | **404 Instructor not found** — the profile query requires `instructor_status = 'verified'` |

### Booking a lesson

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| BOOK-015 | Available slots are listed | user | Instructor has future unbooked slots | Open their profile | Slots for `CURRENT_DATE + 1` onwards are shown with start and end times |
| BOOK-016 | **Booked slots are hidden** | user | The seeded first slot is already booked | Open the profile | That slot does **not** appear |
| BOOK-017 | Past slots are hidden | user | Insert a slot dated yesterday | Open the profile | It does not appear |
| BOOK-018 | Create a booking | user | An open slot exists | Pick a slot → confirm | Response contains `bookingId`, `lessonFee` **3500**, `platformFee` **350**, `totalAmount` **3850**. The booking is created with status **`pending`** (column default) and appears on `/bookings` |
| BOOK-019 | Booking consumes the slot | user | BOOK-018 done | Reload the instructor profile | That slot is gone; `availability_slots.is_booked = TRUE` |
| BOOK-020 | Payment record is created | user | BOOK-018 done | `SELECT * FROM booking_payments WHERE booking_id = …` | One row with `amount_minor = 3850`, `lesson_fee_minor = 3500`, `platform_fee_minor = 350`, `status = 'pending'` |
| BOOK-021 | Commission follows `platform_config` | user | `UPDATE platform_config SET value='20' WHERE key='booking_fee_pct';` | Create another booking | `platform_fee_minor` is now **700** (20 % of 3500) |
| BOOK-022 | Booking with lesson notes | user | — | Book with notes "Need help with roundabouts" | The notes are stored and visible to the instructor on `/instructors/me` |
| BOOK-023 | **Double-book the same slot** | user | Two browsers or two tabs, same open slot | Submit both bookings as close to simultaneously as possible | Exactly **one** succeeds; the other gets **400 Slot not available**. Two bookings on one slot is a defect |
| BOOK-024 | Book an already-booked slot | user | — | `POST /api/bookings` with a `slotId` that is already booked | **400 Slot not available** |
| BOOK-025 | Book with a mismatched instructor/slot pair | user | — | `POST` with instructor A's id and instructor B's slot id | **400 Slot not available** |
| BOOK-026 | Book with an invalid UUID | user | — | `POST` with `slotId:"abc"` | **400** validation error |
| BOOK-027 | **Book your own slot** | instructor | Signed in as the instructor who owns the slot | `POST /api/bookings` for your own slot | Record the result. **No self-booking check exists in the code** — if it succeeds, raise it as `Potential Issue` (see [13](../13-TESTING-GAPS.md)) |

### Managing bookings

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| BOOK-028 | My Bookings lists my bookings | user | Seeded booking exists | Open `/bookings` | The confirmed lesson with Sarah Johnson is shown with date, time, status and amount |
| BOOK-029 | Empty bookings list | user | Fresh account | Open `/bookings` | Empty state, not an error |
| BOOK-030 | Cancel a booking | user | An active booking | Click **Cancel** | Status becomes `cancelled` and the slot is released — confirm it reappears on the instructor's profile |
| BOOK-031 | **Data scope** | user | Two learners each with bookings | Sign in as learner A → `/bookings` | Only A's bookings. **Any of B's bookings appearing is a critical data-leak defect** |
| BOOK-032 | **Update someone else's booking** | user | Learner B's booking id | `PATCH /api/bookings/<B's booking>` with `{"status":"cancelled"}` as learner A | **403 Not authorised to update this booking** |
| BOOK-033 | Instructor can update the booking | instructor | A booking with them | `PATCH /api/bookings/<id>` with `{"status":"completed"}` | **200**; status updates |
| BOOK-034 | Admin can update any booking | admin | Any booking | `PATCH /api/bookings/<id>` | **200** |
| BOOK-035 | **Invalid status value** | user | Own booking | `PATCH /api/bookings/<id>` with `{"status":"hacked"}` | The DTO validates `status` only with `@IsString()`, so this reaches a `booking_status` enum column. Expect a database error surfacing as **500**. **Record the exact status code** — a 500 for a validation problem is a defect (`Potential Issue`, see [13](../13-TESTING-GAPS.md)) |
| BOOK-036 | **A learner marks their own lesson `completed`** | user | Own booking | `PATCH` with `{"status":"completed"}` | The code permits it — there is no per-role transition restriction. Confirm and raise as `Potential Issue` if the business expects only the instructor to do this |
| BOOK-037 | Cancel an already-cancelled booking | user | A cancelled booking | `PATCH` with `{"status":"cancelled"}` again | No error and no duplicate slot release. Record the behaviour |
| BOOK-038 | Booking a non-existent slot | user | — | `POST` with a random UUID `slotId` | **400 Slot not available** |
| BOOK-039 | Unauthenticated booking | — | No token | `POST /api/bookings` | **401** |
| BOOK-040 | Booking appears for the instructor | instructor | BOOK-018 done | Sign in as the instructor → `/instructors/me` | The new booking is listed with the learner's name, the fee breakdown and any lesson notes |
| BOOK-041 | Booking appears in the admin console | admin | BOOK-018 done | `/admin` → Bookings | The booking is listed with both party names and the platform fee |

---

## Traceability

| Test IDs | UI | API | Logic |
|---|---|---|---|
| BOOK-001 … BOOK-012 | `FindInstructorsPage.tsx` | `GET /api/instructors` | `searchInstructors()`, `PostcodeService.require()`, `MAX_NEARBY_KM` |
| BOOK-013, BOOK-014 | `InstructorProfilePage.tsx` | `GET /api/instructors/:id/profile` | `getInstructorProfile()` |
| BOOK-015 … BOOK-017 | `InstructorProfilePage.tsx` | `GET /api/instructors/:id/slots` | `getInstructorSlots()` |
| BOOK-018 … BOOK-027, BOOK-038 | booking form | `POST /api/bookings` | `createBooking()`, `platform_config.booking_fee_pct` |
| BOOK-028 … BOOK-031 | `BookingsPage.tsx` | `GET /api/bookings/mine` | `getMyBookings()` |
| BOOK-030, BOOK-032 … BOOK-037 | Cancel button | `PATCH /api/bookings/:id` | `updateBooking()` — ownership check |
</content>
