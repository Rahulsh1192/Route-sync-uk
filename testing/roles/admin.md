# Role — `admin`

**Prefix:** `ROLE-ADM-###`

> *"If I sign in as an admin, what exactly should I be able to do?"*

**Test accounts:** `admin@routesync.uk` and `demo@routesync.uk` — both `admin`, both with
a **universal** `premium_yearly` subscription. `demo@routesync.uk` owns almost every
seeded route.

---

## 1. The shape of this role

`admin` is the union of two permission sets:

- **`@Roles('moderator','admin')`** — the whole admin console.
- **`@Roles('admin')`** — the sensitive overrides: revenue, user role/suspension, and all
  money movement.
- **`@Roles('instructor','admin')`** — the content-creation endpoints: test-centre writes,
  uploads, reference routes and journeys.

**It is not a superuser.** `RolesGuard` is a flat membership test, so an endpoint marked
`@Roles('instructor')` **excludes admin**. That applies to the entire instructor
availability surface:

| Endpoint | Admin |
|---|---|
| `PUT /api/instructors/me/profile` | **403** |
| `GET /api/instructors/me/slots` | **403** |
| `POST /api/instructors/me/slots` | **403** |
| `DELETE /api/instructors/me/slots/:slotId` | **403** |
| `GET /api/instructors/me/bookings` | **403** |

Test this explicitly — `ROLE-ADM-020`.

---

## 2. Expected navigation

**Post-login landing:** `/admin`.

**Admin console sidebar:** Review Queue · Users · Instructors · Bookings ·
Reference Routes · Revenue · Community Fund · Instructor Earnings · Reports, plus
**Main app** and **Sign out**.

**Clicking "Main app":** the **staff** navigation (Test Centres · Discover Routes ·
My Lessons · Contribute · Account) — because `isStaffRole()` includes `admin`.

---

## 3. Accessible modules and allowed actions

| Module | Admin capability |
|---|---|
| Review Queue | View, open detail, **approve**, **reject** |
| Analytics | Stat tiles and nav badges |
| **Revenue** | View subscription breakdown and MRR — **admin-exclusive** |
| **Users** | Search, **change any role**, **suspend / reinstate** — **admin-exclusive writes** |
| Instructors | View applications, open badge evidence, approve, reject |
| Bookings | View all; **update any booking** via `PATCH /api/bookings/:id` |
| **Community Fund** | View, **create beneficiaries**, **allocate**, **record payouts**, **run the monthly contribution** — writes are **admin-exclusive** |
| **Instructor Earnings** | View runs and balances, **run attribution** — the run is **admin-exclusive** |
| Reports | View open reports and the moderation log |
| Reference Routes | View **and create** |
| Test Centres | **Create, edit, delete**; postcode lookup |
| Contribute / Uploads | Full upload flow, attach video |
| Journeys | Start, live-check, submit, list own |
| Learner features | Everything — and with the seeded universal Premium, **no paywall anywhere** |

---

## 4. Restricted actions

| Restricted | Endpoint | Expected |
|---|---|---|
| Manage an instructor profile or availability | `/api/instructors/me/profile`, `/slots`, `/bookings` | **403** — `@Roles('instructor')` is exclusive |
| Bypass the worker-secret guard | `POST /api/internal/journeys/analyse-upload` | **403 / 503** — a user JWT is not accepted here at all |
| Bypass the Stripe webhook signature | `POST /api/webhooks/stripe` | **400** — being an admin grants nothing |

**Not restricted, and worth noting:** there is **no self-protection**. An admin can
suspend their own account, demote themselves, and demote the last remaining admin —
`ROLE-ADM-021`, `ROLE-ADM-022`.

---

## 5. Expected data visibility

Everything the moderator sees, **plus** revenue and MRR. Uploads and journeys are still
**ownership-scoped**: an admin's own uploads are visible to them, but
`GET /api/uploads/<another user's id>` returns **403 Not your upload** — the ownership
check has no admin exemption. `GET /api/journeys/:id` **does** have a staff exemption.

Test both — `ROLE-ADM-018`, `ROLE-ADM-019`.

---

## 6. Role walkthrough

| Test ID | Step | Expected Result |
|---|---|---|
| ROLE-ADM-001 | Sign in as `admin@routesync.uk` | Lands **directly on `/admin`** |
| ROLE-ADM-002 | Inspect the console | Nine panels, stat tiles, and count badges on Review Queue (3) and Instructors (3) |
| ROLE-ADM-003 | Open every panel in turn | All nine load without a 403 — including **Revenue**, which a moderator cannot open |
| ROLE-ADM-004 | Approve a route in the Review Queue | Published; visible to learners; `approvals` and `audit_log` rows written |
| ROLE-ADM-005 | Approve an ADI application | The applicant's role becomes `instructor` |
| ROLE-ADM-006 | Change a user's role in the Users panel | Saved and audited |
| ROLE-ADM-007 | Suspend and reinstate a throwaway account | Both succeed; login is blocked while suspended |
| ROLE-ADM-008 | Add a fund beneficiary and record a payout | Both succeed; audited; a payout above the balance is refused |
| ROLE-ADM-009 | Run the monthly fund contribution | Succeeds; a second run for the same period is skipped |
| ROLE-ADM-010 | Run rev-share attribution | Succeeds; a second run for the same period is skipped |
| ROLE-ADM-011 | Create a reference route | Succeeds |
| ROLE-ADM-012 | Click **Main app** | Goes to `/test-centres` with the **staff** navigation (Contribute, My Lessons) |
| ROLE-ADM-013 | Create, edit and delete a test centre | All three succeed; deleting a centre with routes is refused |
| ROLE-ADM-014 | Open `/contribute/upload` | The wizard renders and is usable |
| ROLE-ADM-015 | Open `/account` | The **staff** shortcuts; **no** "Become an instructor" block; the Premium panel shows the active universal subscription |
| ROLE-ADM-016 | Watch several routes at different centres | **All play** — the universal subscription bypasses the per-centre paywall entirely |

---

## 7. Negative and boundary tests

| Test ID | Attempt | Level | Expected Result |
|---|---|---|---|
| ROLE-ADM-017 | Open `/instructors/me` | Route + API | The page renders, then the profile and slot calls return **403**. Confirm it degrades readably |
| ROLE-ADM-018 | **`GET /api/uploads/<another user's upload id>`** | API (data) | **403 Not your upload** — the ownership check has **no admin exemption**. Confirm |
| ROLE-ADM-019 | `GET /api/journeys/<another user's journey id>` | API (data) | **200** — staff **are** exempted here. Confirm the asymmetry with `ROLE-ADM-018` and raise it for clarification |
| ROLE-ADM-020 | `POST /api/instructors/me/slots` with an admin token | API | **403 Insufficient role** |
| ROLE-ADM-021 | **Suspend your own account** | API | No self-protection exists. Record the result. **Have a second admin signed in before running this** |
| ROLE-ADM-022 | **Demote the last admin** | API | No last-admin protection exists. Record the result — potentially an unrecoverable lockout |
| ROLE-ADM-023 | `POST /api/internal/journeys/analyse-upload` with an admin bearer token and no `x-worker-secret` | API | **403 / 503** — a user JWT must not satisfy the worker guard |
| ROLE-ADM-024 | `POST /api/webhooks/stripe` with an admin token and no valid signature | API | **400** — signature verification is not role-based |
| ROLE-ADM-025 | `PATCH /api/users/me` with `{"role":"user"}` | API | **400** — unknown property; the role is not editable through the self endpoint even for an admin |
| ROLE-ADM-026 | Approve a route **twice** | API | Succeeds both times — no state-machine guard. See `ADM-RQ-021` |
| ROLE-ADM-027 | Delete a test centre created by an instructor | API | Succeeds (if it has no routes) — there is no ownership model on test centres |
</content>
