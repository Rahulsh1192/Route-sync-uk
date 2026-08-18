# Module — Admin: Users

**Prefix:** `ADM-USR-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | Search every account, change a user's role, and suspend or reinstate an account. |
| **Web path** | `/admin` → **Users** |
| **API** | `GET /api/admin/users?q=` · `PATCH /api/admin/users/:id` |
| **Roles** | **Read:** `moderator`, `admin`. **Write:** **`admin` only** (`@Roles('admin')` overrides the class default) |
| **Components** | [admin/panels/Users.tsx](../../apps/web/src/admin/panels/Users.tsx) |
| **Backend** | [admin.controller.ts](../../apps/api/src/modules/admin/admin.controller.ts) · [admin.service.ts](../../apps/api/src/modules/admin/admin.service.ts) |
| **Dependencies** | Auth (a suspended user cannot log in) · Bookings (a suspended instructor disappears from search) · this panel is how QA creates a `moderator` |

---

## ⚠ This panel is the only way to create a moderator

The seed contains no `moderator` account. Use this panel to promote a **throwaway**
account you registered yourself — not one of the seeded accounts, or you will break the
tests that depend on their original roles.

---

## Business rules found in the implementation

1. **Search matches** email (substring, case-insensitive), display name (substring), and
   **phone with all non-digits stripped from both sides** — so `07700900123` finds a
   number stored as `07700 900123`.
2. **Only non-deleted users** are listed (`deleted_at IS NULL`), newest first,
   **limit 50**. There is **no pagination**.
3. **The list includes personal data**: email, phone, emergency contact name and emergency
   contact phone. Treat this as a data-protection surface.
4. **`PATCH /api/admin/users/:id` accepts `role` and/or `isSuspended`.** Sending neither →
   **400 Nothing to update**. `role` must be a valid `UserRole` enum value.
5. **Every change is audited** — an `audit_log` row with action `user.update`, the acting
   admin's id, and the changed fields.
6. **A suspended user cannot log in** (`401 Account suspended`) — but an **already-issued
   access token keeps working until it expires**. There is no session revocation on
   suspension.
7. **Role changes do not revoke sessions either.** The role lives in the access token, so
   the change only takes effect after a refresh or a fresh login.
8. **Role options offered in the UI:** `user`, `contributor`, `instructor`, `moderator`,
   `admin` — the full enum.

---

## UI components

Search input (`placeholder="Search by name, email or phone…"`) · search button · results
table with columns for user (name, email, phone, emergency contact), **Role** as a
`<select>` (`aria-label="Role for <name>"`), **Status** as an Active/Suspended pill, and a
**Suspend**/**Reinstate** button (`aria-label="Suspend <name>"` / `"Reinstate <name>"`) ·
loading, empty and error states.

---

## Functional test cases

### Read and search

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-USR-001 | Users panel loads | admin | Seeded | `/admin` → **Users** | All 7 seeded users are listed with role and status |
| ADM-USR-002 | Search by email | admin | — | Type `learner@` → Search | Only `learner@routesync.uk` |
| ADM-USR-003 | Search by display name | admin | — | Type `Sarah` | `Sarah Johnson (ADI)` |
| ADM-USR-004 | Partial, case-insensitive search | admin | — | Type `PRIYA`, then `priya` | Identical results |
| ADM-USR-005 | **Search by phone, ignoring formatting** | admin | Set a user's phone to `07700 900123` (`ACCT-002`) | Search `07700900123` | That user is found. This is the point of the digit-stripping match |
| ADM-USR-006 | Search with no matches | admin | — | Type `zzzzzz` | Empty state, no error |
| ADM-USR-007 | Clear the search | admin | — | Clear the input and search | The full list returns |
| ADM-USR-008 | List limit | admin | Create > 50 accounts | Load the panel | At most 50 rows. **There is no pagination** — record this as a usability gap |
| ADM-USR-009 | Deleted users are hidden | admin | Complete `ACCT-020` on a throwaway account | Search for it | Absent |
| ADM-USR-010 | Personal data is shown | admin | A user with contact details | Look at their row | Email, phone and emergency contact are visible. Confirm with the data-protection owner that this is intended for **moderators** as well as admins (`Needs Clarification`) |

### Write actions (admin only)

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-USR-011 | **Promote to moderator** | admin | A throwaway account | Change its Role select to `moderator` | Saved. Sign in as that account → it lands on `/admin`, with a **restricted** console |
| ADM-USR-012 | **Promote to instructor** | admin | A throwaway `user` | Set Role to `instructor` | Saved. After signing out and in, that account gets the **staff** navigation. Note it will **not** appear in instructor search until `contributors.instructor_status = 'verified'` |
| ADM-USR-013 | Demote an instructor | admin | The instructor account | Set Role to `user` | Saved; on next sign-in the staff nav is gone and `/api/instructors/me/slots` returns 403 |
| ADM-USR-014 | **Suspend an account** | admin | A throwaway account | Click **Suspend** | The pill becomes **Suspended**; that user can no longer log in (`AUTH-015`) |
| ADM-USR-015 | **Reinstate** | admin | ADM-USR-014 done | Click **Reinstate** | The pill returns to **Active**; login works again |
| ADM-USR-016 | Suspending an instructor removes them from search | admin then user | Suspend `instructor@routesync.uk` | Search on `/instructors/find` | They are gone (BOOK-010). **Reinstate afterwards** |
| ADM-USR-017 | **Changes are audited** | admin | ADM-USR-011 done | `SELECT * FROM audit_log WHERE action='user.update' ORDER BY created_at DESC LIMIT 1;` | The acting admin's id, the target user id and the changed fields are recorded |
| ADM-USR-018 | Empty update | admin | — | `PATCH /api/admin/users/<id>` with `{}` | **400 Nothing to update** |
| ADM-USR-019 | Invalid role value | admin | — | `PATCH` with `{"role":"superuser"}` | **400** |
| ADM-USR-020 | Non-existent user | admin | — | `PATCH /api/admin/users/00000000-0000-0000-0000-000000000000` with `{"isSuspended":true}` | An error, not a success. Record the exact status code — a raw Prisma **500** here is worth raising |
| ADM-USR-021 | **Suspend yourself** | admin | Signed in as `admin@routesync.uk` | Suspend your own account | The code has **no self-protection check**. Record the result — if it succeeds you are locked out at next login. Raise as `Potential Issue`. Have a second admin available before running this |
| ADM-USR-022 | **Demote the last admin** | admin | Only one admin exists | Set your own role to `user` | The code has **no last-admin protection**. Record the result and raise as `Potential Issue` |
| ADM-USR-023 | **Suspension does not kill the live session** | admin + target | The target is signed in in another browser | Suspend them, then have them navigate in the app **without** refreshing the token | They keep working until the access token expires (default 900 s). Confirm and raise the severity with the security owner — see `EDGE-015` |

### Authorisation

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-USR-024 | **Moderator can read the list** | moderator | Moderator account | Open the Users panel | The list renders — reading is allowed at `@Roles('moderator','admin')` |
| ADM-USR-025 | **Moderator cannot change a role** | moderator | Moderator account | Change a Role select in the panel | **403 Insufficient role**. The UI does **not** disable the control, so confirm the failure is a readable message and that the select reverts. API test: `PERM-019`; raise the missing UI gating as **PI-06** |
| ADM-USR-026 | **Moderator cannot suspend** | moderator | — | Click **Suspend** | **403**, same UI caveat |
| ADM-USR-027 | Learner cannot read the list | user | Learner token | `GET /api/admin/users` | **403** |
| ADM-USR-028 | **Learner cannot self-promote** | user | Learner token | `PATCH /api/admin/users/<own id>` with `{"role":"admin"}` | **403**. A 200 here is a **critical privilege-escalation defect** |
| ADM-USR-029 | Instructor cannot change roles | instructor | Instructor token | `PATCH /api/admin/users/<id>` | **403** |
| ADM-USR-030 | Unauthenticated | — | No token | `GET /api/admin/users` | **401** |

---

## Traceability

| Test IDs | UI | API | Guard | Logic |
|---|---|---|---|---|
| ADM-USR-001 … ADM-USR-010, ADM-USR-024, ADM-USR-027 | `panels/Users.tsx` | `GET /api/admin/users` | `@Roles('moderator','admin')` | `AdminService.users()` |
| ADM-USR-011 … ADM-USR-023, ADM-USR-025 … ADM-USR-029 | Role select, Suspend button | `PATCH /api/admin/users/:id` | **`@Roles('admin')`** | `AdminService.updateUser()` + `audit_log` |
| ADM-USR-014 … ADM-USR-016, ADM-USR-023 | — | `POST /api/auth/login` | — | `AuthService.login()` — `Account suspended` |
</content>
