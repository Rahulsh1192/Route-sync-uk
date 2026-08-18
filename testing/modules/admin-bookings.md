# Module — Admin: Bookings

**Prefix:** `ADM-BKG-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | A platform-wide, read-only view of every lesson booking, with both parties named and the commission shown. |
| **Web path** | `/admin` → **Bookings** |
| **API** | `GET /api/admin/bookings?page=` (read) · `PATCH /api/bookings/:id` (an admin may also update any booking, from the learner-facing endpoint) |
| **Roles** | `admin`, `moderator` |
| **Components** | [admin/panels/Bookings.tsx](../../apps/web/src/admin/panels/Bookings.tsx) |
| **Backend** | `adminGetAllBookings()` in [bookings.service.ts](../../apps/api/src/modules/bookings/bookings.service.ts) |
| **Dependencies** | [bookings.md](bookings.md) produces the data · `platform_config.booking_fee_pct` determines the commission column |

---

## Preconditions

- Signed in as `admin@routesync.uk` or a moderator.
- The seed provides one confirmed booking (`learner@routesync.uk` ↔ Sarah Johnson).
- Create a second booking first (`BOOK-018`) so ordering and paging have something to work
  with.

---

## Business rules found in the implementation

1. **All bookings, no filtering by status or party.** Ordered by `slot_date DESC`,
   **50 per page**, paged via `?page=` (zero-based, `OFFSET page × 50`).
2. **Each row joins**: the booking, its slot (date and start time), the **learner's**
   display name, the **instructor's** display name, and the payment row
   (`amount_minor`, `platform_fee_minor`, payment `status`).
3. **The panel is read-only.** There is no approve/cancel/refund control in the UI.
4. **An admin or moderator can still change any booking** through
   `PATCH /api/bookings/:id` — `updateBooking()` explicitly allows
   `actorRole === 'admin' || actorRole === 'moderator'`.

---

## UI components

Bookings table — learner name, instructor name, slot date and start time, booking status,
amount, platform fee, payment status · loading, empty and error states.
**No action buttons.**

---

## Functional test cases

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-BKG-001 | Panel loads | admin | Seeded booking exists | `/admin` → **Bookings** | The seeded booking is listed with both party names |
| ADM-BKG-002 | Row content | admin | — | Inspect a row | Learner **Alex (Learner)**, instructor **Sarah Johnson (ADI)**, the slot date and start time, status `confirmed`, the amount and the platform fee |
| ADM-BKG-003 | Commission is visible | admin | A booking created via `BOOK-018` | Inspect its row | `platform_fee_minor` = 10 % of the lesson fee (350 for a £35 lesson), and the total is lesson + fee |
| ADM-BKG-004 | A new booking appears here | admin | Complete `BOOK-018` | Reload the panel | The new booking is present |
| ADM-BKG-005 | Ordering | admin | Bookings on different slot dates | Read the order | Newest `slot_date` first |
| ADM-BKG-006 | Cancelled bookings are still listed | admin | Complete `BOOK-030` | Reload | The cancelled booking is **still shown**, with status `cancelled` — this view does not filter by status |
| ADM-BKG-007 | Pagination | admin | Create > 50 bookings, or call the API directly | `GET /api/admin/bookings?page=0` then `?page=1` | 50 rows per page; page 1 continues after page 0. Confirm whether the **UI** exposes paging at all — if it does not, record it as a gap |
| ADM-BKG-008 | Empty state | admin | A database with no bookings | Load the panel | Friendly empty state, not an error |
| ADM-BKG-009 | Invalid page parameter | admin | — | `GET /api/admin/bookings?page=abc` | **400** — `ParseIntPipe` rejects it |
| ADM-BKG-010 | Negative page | admin | — | `GET /api/admin/bookings?page=-1` | Record the behaviour. A negative `OFFSET` is a database error, so a **500** here is worth raising (`Potential Issue`) |
| ADM-BKG-011 | **Moderator can view** | moderator | Moderator account | Open the panel | The list renders — `@Roles('admin','moderator')` |
| ADM-BKG-012 | **Admin can change any booking** | admin | Any booking id | `PATCH /api/bookings/<id>` with `{"status":"cancelled"}` | **200**; the status changes and the slot is released. Note there is **no UI** for this — it is API-only |
| ADM-BKG-013 | **Moderator can change any booking** | moderator | Any booking id | Same call with a moderator token | **200** — moderators are included in the same check. Confirm with the product owner that this is intended (`Needs Clarification`) |
| ADM-BKG-014 | Learner cannot read all bookings | user | Learner token | `GET /api/admin/bookings` | **403** |
| ADM-BKG-015 | Instructor cannot read all bookings | instructor | Instructor token | `GET /api/admin/bookings` | **403** — an instructor sees only their own via `/api/instructors/me/bookings` |
| ADM-BKG-016 | Unauthenticated | — | No token | `GET /api/admin/bookings` | **401** |
| ADM-BKG-017 | **Personal data exposure** | moderator | — | Inspect the response payload in DevTools | Record exactly which learner personal data is returned. Confirm with the data-protection owner that a moderator should see it (`Needs Clarification`) |

---

## Traceability

| Test IDs | UI | API | Guard | Logic |
|---|---|---|---|---|
| ADM-BKG-001 … ADM-BKG-011, ADM-BKG-014 … ADM-BKG-017 | `panels/Bookings.tsx` | `GET /api/admin/bookings` | `@Roles('admin','moderator')` | `adminGetAllBookings()` |
| ADM-BKG-012, ADM-BKG-013 | *(no UI)* | `PATCH /api/bookings/:id` | `JwtAuthGuard` + in-service role check | `updateBooking()` — `isAdmin` branch |
</content>
