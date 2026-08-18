# Role — `contributor`

**Prefix:** `ROLE-CON-###`

> *"If I sign in as a contributor, what exactly should I be able to do?"*

**Test accounts:** `james.carter@example.com`, `priya.sharma@example.com`,
`tom.briggs@example.com` — all seeded with a **pending** ADI application.

---

## 1. The single most important fact about this role

**`contributor` has exactly the same enforced permissions as `user`.**

Verified by searching every `@Roles(...)` decorator in the API: **no endpoint anywhere
lists `contributor`**. `RolesGuard` performs a flat membership test, so a role that never
appears in a `@Roles` list can only reach endpoints that have no role requirement at all —
which is precisely the set `user` can reach.

The only place the two differ is cosmetic: `canApplyAsInstructor()` in
[apps/web/src/api/types.ts](../../apps/web/src/api/types.ts) returns true for **both**
`user` and `contributor`, so both see the "Become an instructor" call to action.

In the seed data, `contributor` marks an account that has **applied** for ADI
verification and is awaiting a decision. The name suggests upload rights; **it grants
none**. Flagged as `Needs Clarification` in [13-TESTING-GAPS.md](../13-TESTING-GAPS.md) —
if the business intends `contributor` to mean something, the code does not implement it.

---

## 2. Expected navigation

Identical to `user` — `isStaffRole()` is false for `contributor`.

**Post-login landing:** `/test-centres`.
**Desktop:** Test Centres · Discover Routes · Book a Driving Instructor · My Bookings · Account.
**Mobile:** Test Centres · Discover · Book a Lesson · Account.

**Must NOT be present:** Contribute, My Lessons, any link to `/admin`.

---

## 3. Accessible modules, allowed actions, data visibility

**Identical to [user-learner.md](user-learner.md).** Do not duplicate that test run —
instead run the differential checks below plus a spot-check of the learner negative tests.

---

## 4. Role walkthrough

| Test ID | Step | Expected Result |
|---|---|---|
| ROLE-CON-001 | Sign in as `james.carter@example.com` | Lands on `/test-centres` — **not** the admin console, **not** a contributor dashboard |
| ROLE-CON-002 | Inspect the navigation | The **learner** navigation. **No Contribute tab**, even though the role is called "contributor" |
| ROLE-CON-003 | Open `/account` | The **Become an instructor** block is shown (same as `user`) |
| ROLE-CON-004 | Open `/contribute` by typing the URL | Renders the "verified instructors only" message with a button to `/contribute/instructor`, plus the Credits / Reputation / Published stats |
| ROLE-CON-005 | Open `/contribute/instructor` | The verification page loads and shows this account's application as **pending** with its ADI number |
| ROLE-CON-006 | Try to submit a second application | **409 A verification request is already pending** |
| ROLE-CON-007 | Watch a route | Behaves exactly like a learner — one free demo route, then the paywall |

---

## 5. Differential negative tests

These confirm that the role's name does not grant anything.

| Test ID | Attempt | Level | Expected Result |
|---|---|---|---|
| ROLE-CON-008 | **`POST /api/uploads`** with a contributor token | API | **403 Insufficient role**. A 200 here would mean the role grants upload rights the UI never offers — raise it either way for clarification |
| ROLE-CON-009 | `POST /api/uploads/routes/<id>/attach-video` | API | **403** |
| ROLE-CON-010 | `POST /api/test-centres` | API | **403** |
| ROLE-CON-011 | `POST /api/reference-routes` | API | **403** |
| ROLE-CON-012 | `POST /api/journeys` | API | **403** |
| ROLE-CON-013 | `GET /api/instructors/me/journeys` | API | **403** |
| ROLE-CON-014 | `PUT /api/instructors/me/profile` | API | **403** |
| ROLE-CON-015 | `GET /api/admin/review-queue` | API | **403** |
| ROLE-CON-016 | Navigate to `/admin` | Route | Redirected to `/test-centres` |
| ROLE-CON-017 | Look for a Contribute tab | UI | Absent |
| ROLE-CON-018 | `GET /api/contributors/me/profile` | API | **200** — this endpoint has no role gate; any authenticated user can read their own contributor stats |

---

## 6. Transition out of this role

| Test ID | Step | Expected Result |
|---|---|---|
| ROLE-CON-019 | An admin **approves** the pending application (`ADM-INS-010`) | `users.role` becomes **`instructor`**; after signing out and back in, the account gets the **staff** navigation and full contribution rights — continue in [instructor.md](instructor.md) |
| ROLE-CON-020 | An admin **rejects** the application (`ADM-INS-014`) | `users.role` **stays `contributor`**; `contributors.instructor_status` becomes `rejected`; the account keeps learner-only permissions |
| ROLE-CON-021 | After a rejection, re-apply | Accepted — a rejection does not permanently bar a new application |
</content>
