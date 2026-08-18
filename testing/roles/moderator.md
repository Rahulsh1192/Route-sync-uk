# Role — `moderator`

**Prefix:** `ROLE-MOD-###`

> *"If I sign in as a moderator, what exactly should I be able to do?"*

**Test account:** **none is seeded.** Create one first — see
[12-TEST-ENVIRONMENT-AND-DATA.md §3.1](../12-TEST-ENVIRONMENT-AND-DATA.md). Promote a
throwaway account, never a seeded one.

---

## 1. The shape of this role

`moderator` is **"the admin console with the sensitive actions removed"**. It is defined
in two places that do **not** agree with each other, and that disagreement is the most
important thing to test:

| Definition | Includes `moderator`? | Effect |
|---|---|---|
| `isAdminRole()` in [App.tsx](../../apps/web/src/App.tsx) | **Yes** | Lands on `/admin`; the console renders |
| `isStaffRole()` in [types.ts](../../apps/web/src/api/types.ts) | **No** | In the main app they get the **learner** navigation |
| `@Roles('moderator','admin')` — admin controller class default | **Yes** | Most console endpoints work |
| `@Roles('admin')` — method overrides | **No** | Revenue, user writes and all money movement are refused |
| `@Roles('instructor','admin')` — content endpoints | **No** | No test-centre writes, no uploads, no journeys, no reference routes |

**Consequence:** the console renders **every** nav item, including ones the moderator's
token cannot use. Clicking **Revenue** produces a 403. The UI does not hide or disable it.
That is **PI-06** in [13-TESTING-GAPS.md](../13-TESTING-GAPS.md) — raise it once.

---

## 2. Expected navigation

**Post-login landing:** `/admin`.

**Admin console sidebar:** all nine panels are shown — Review Queue · Users · Instructors ·
Bookings · Reference Routes · Revenue · Community Fund · Instructor Earnings · Reports —
plus **Main app** and **Sign out**.

**Clicking "Main app":** the **learner** navigation (Test Centres · Discover Routes ·
Book a Driving Instructor · My Bookings · Account). **No Contribute tab.**

---

## 3. Allowed actions

| Module | Allowed |
|---|---|
| Review Queue | View the queue, open a route's detail, **approve**, **reject** |
| Analytics | View the stat tiles and nav badges |
| Users | **View only** — search including phone matching |
| Instructors | View pending applications, open **badge evidence**, **approve**, **reject** (which promotes an account to `instructor`) |
| Bookings | View **all** platform bookings; **update any booking** via `PATCH /api/bookings/:id` |
| Reports | View open reports and the moderation log |
| Community Fund | View the summary and beneficiary list |
| Instructor Earnings | View runs, run detail and instructor balances |
| Reference Routes | **View** the list only |
| Learner features | Everything a `user` can do — browse, watch (entitlement-gated), book a lesson |

---

## 4. Restricted actions

| Restricted | Endpoint | Expected |
|---|---|---|
| See revenue / MRR | `GET /api/admin/revenue` | **403** |
| Change a user's role | `PATCH /api/admin/users/:id` | **403** |
| Suspend / reinstate a user | `PATCH /api/admin/users/:id` | **403** |
| Create a fund beneficiary | `POST /api/admin/fund/beneficiaries` | **403** |
| Allocate to the fund | `POST /api/admin/fund/allocate` | **403** |
| Record a fund payout | `POST /api/admin/fund/payout` | **403** |
| Run the monthly contribution | `POST /api/admin/fund/run-contribution` | **403** |
| Run rev-share attribution | `POST /api/admin/revshare/run` | **403** |
| Create / edit / delete a test centre | `/api/test-centres` | **403** |
| Postcode lookup helper | `GET /api/test-centres/lookup/postcode` | **403** |
| Any upload action | `/api/uploads/*` | **403** |
| Create a reference route | `POST /api/reference-routes` | **403** |
| Any journey action | `POST /api/journeys*` | **403** |
| Instructor profile / slots / own bookings | `/api/instructors/me/*` | **403** |

---

## 5. Expected data visibility

**Sees:** every user's row including email, phone and emergency contact · every booking
with both parties named · **ADI badge evidence** (identity documents) via signed URLs ·
the full moderation and audit log · fund and rev-share figures.

**Does not see:** revenue / MRR.

> That combination is worth flagging with the data-protection owner: a moderator sees
> personal contact details and identity documents but is deliberately blocked from
> financial figures. Confirm it is intended — `ADM-USR-010`, `ADM-BKG-017`.

---

## 6. Role walkthrough

| Test ID | Step | Expected Result |
|---|---|---|
| ROLE-MOD-001 | Sign in as the moderator | Lands **directly on `/admin`**, not on `/test-centres` |
| ROLE-MOD-002 | Inspect the console sidebar | All nine panels plus Main app and Sign out |
| ROLE-MOD-003 | Open **Review Queue** | Loads with the pending routes |
| ROLE-MOD-004 | **Approve** a route | Succeeds; the route is published and visible to learners |
| ROLE-MOD-005 | Open **Users** | The list renders (read is allowed) |
| ROLE-MOD-006 | Open **Instructors** | Pending applications render |
| ROLE-MOD-007 | **Approve** an ADI application | Succeeds; the applicant's role becomes `instructor` |
| ROLE-MOD-008 | Open **Bookings** | All platform bookings render |
| ROLE-MOD-009 | Open **Reports** | Renders (empty on seed data) |
| ROLE-MOD-010 | Open **Community Fund** | The summary renders |
| ROLE-MOD-011 | Open **Instructor Earnings** | Runs and balances render |
| ROLE-MOD-012 | Open **Reference Routes** | The list renders |
| ROLE-MOD-013 | Click **Main app** | Goes to `/test-centres` with the **learner** navigation — **no Contribute tab**, **no + New test centre button** |
| ROLE-MOD-014 | Open `/account` as the moderator | Record what renders — the page has **no branch for `moderator`**, so neither the staff shortcuts nor the "Become an instructor" block should appear. Confirm the page is still usable |

---

## 7. Negative access tests

| Test ID | Attempt | Level | Expected Result |
|---|---|---|---|
| ROLE-MOD-015 | Click **Revenue** in the console | UI + API | **403**. The nav item is **not hidden** — confirm the panel shows a readable error rather than a blank or broken view. API test: `PERM-018`; the UI gap is **PI-06** |
| ROLE-MOD-016 | Change a Role select in the Users panel | UI + API | **403**. The control is **not disabled** — confirm the select reverts and an error is shown. API test: `PERM-019`; the UI gap is **PI-06** |
| ROLE-MOD-017 | Click **Suspend** in the Users panel | UI + API | **403** |
| ROLE-MOD-018 | Add a beneficiary in the Fund panel | UI + API | **403** — the form is not hidden |
| ROLE-MOD-019 | Record a payout | UI + API | **403** |
| ROLE-MOD-020 | Click **Run now** on the monthly contribution | UI + API | **403** |
| ROLE-MOD-021 | Click **Run now** on the attribution run | UI + API | **403** |
| ROLE-MOD-022 | Create a reference route in the panel | UI + API | **403** — the create form is not hidden |
| ROLE-MOD-023 | `POST /api/test-centres` | API | **403** |
| ROLE-MOD-024 | `POST /api/uploads` | API | **403** |
| ROLE-MOD-025 | `POST /api/journeys` | API | **403** |
| ROLE-MOD-026 | `PUT /api/instructors/me/profile` | API | **403** |
| ROLE-MOD-027 | `POST /api/instructors/me/slots` | API | **403** |
| ROLE-MOD-028 | Look for a **+ New test centre** button in the main app | UI | Absent (`isStaffRole` excludes moderator) |
| ROLE-MOD-029 | Look for a **Contribute** tab in the main app | UI | Absent |
| ROLE-MOD-030 | Watch a second route with no Premium | API | **403** / paywall — moderators get no entitlement bypass |

---

## 8. Open questions for the product owner

| # | Question |
|---|---|
| 1 | Should a moderator have the **learner** navigation in the main app, or the staff navigation? The two role definitions disagree — see §1 |
| 2 | Should the console **hide or disable** the panels and controls a moderator cannot use, rather than letting them 403? |
| 3 | Should a moderator be able to **update any booking** (`ADM-BKG-013`)? |
| 4 | Should a moderator see learners' **phone numbers and emergency contacts**, and ADI **badge evidence**? |
| 5 | What should `/account` render for a moderator? There is no branch for the role |
</content>
