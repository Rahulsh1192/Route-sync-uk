# Test Routify — QA Testing Handbook

This folder is a **manual end-to-end testing package** for the Test Routify platform.
It is written for a tester who has never seen the codebase.

Everything in here was derived by reading the implementation. Where behaviour could
**not** be established from the code, it is marked **`Needs Clarification`** rather than
guessed. Where the code suggests a defect but does not prove one, it is marked
**`Potential Issue`** in [13-TESTING-GAPS.md](13-TESTING-GAPS.md).

---

## 1. What you are testing

**Test Routify** is a UK driving-test preparation platform. Learners watch real,
GPS-synchronised dashcam recordings of driving-test routes, practise them later as
turn-by-turn voice navigation, and book lessons with verified driving instructors (ADIs).
Instructors contribute the route footage; admins moderate it.

There is **one web application**. The admin console is not a separate app — it lives
inside the same React app at `/admin` and is role-gated.

Start with [01-APPLICATION-OVERVIEW.md](01-APPLICATION-OVERVIEW.md).

---

## 2. Document map

| Document | What it gives you |
|---|---|
| [01-APPLICATION-OVERVIEW.md](01-APPLICATION-OVERVIEW.md) | What the app does, its modules, navigation, auth/authz mechanisms, module inventory |
| [02-USERS-ROLES-PERMISSIONS.md](02-USERS-ROLES-PERMISSIONS.md) | The five roles, where each is defined in code, what each can do |
| [03-ACCESS-CONTROL-MATRIX.md](03-ACCESS-CONTROL-MATRIX.md) | Role → Module → Feature → Action → Expected access |
| [04-AUTHENTICATION-TESTING.md](04-AUTHENTICATION-TESTING.md) | Login, register, tokens, sessions, verification, password reset |
| [05-END-TO-END-WORKFLOWS.md](05-END-TO-END-WORKFLOWS.md) | Cross-module business workflows |
| [06-NEGATIVE-TESTING.md](06-NEGATIVE-TESTING.md) | Invalid input, unauthorised access, forbidden APIs |
| [07-EDGE-CASES.md](07-EDGE-CASES.md) | Boundaries, empty states, concurrency, tabs, refresh |
| [08-REGRESSION-CHECKLIST.md](08-REGRESSION-CHECKLIST.md) | Tickable per-release checklist |
| [09-STATE-AND-DATA-FLOW.md](09-STATE-AND-DATA-FLOW.md) | Status transitions and cross-module data propagation |
| [10-ERROR-AND-RECOVERY.md](10-ERROR-AND-RECOVERY.md) | API failure, network failure, timeouts, recovery |
| [11-RESPONSIVE-AND-ACCESSIBILITY.md](11-RESPONSIVE-AND-ACCESSIBILITY.md) | Breakpoints, keyboard, focus, semantics |
| [12-TEST-ENVIRONMENT-AND-DATA.md](12-TEST-ENVIRONMENT-AND-DATA.md) | **Setup, accounts, credentials, seed data, what QA must prepare** |
| [13-TESTING-GAPS.md](13-TESTING-GAPS.md) | Potential issues, unclear behaviour, things not verifiable from code |
| [14-COVERAGE-AUDIT.md](14-COVERAGE-AUDIT.md) | Audit of this pack against the codebase |
| [modules/](modules/) | One test-case document per functional module |
| [roles/](roles/) | One document per role: "what should I be able to do as this role?" |

---

## 3. Recommended QA execution sequence

Ordered by the application's real dependencies — later steps need data produced by
earlier ones.

1. **Read** [01-APPLICATION-OVERVIEW.md](01-APPLICATION-OVERVIEW.md) and
   [02-USERS-ROLES-PERMISSIONS.md](02-USERS-ROLES-PERMISSIONS.md).
2. **Prepare the environment and seed data** — [12-TEST-ENVIRONMENT-AND-DATA.md](12-TEST-ENVIRONMENT-AND-DATA.md).
   Nothing else works until the database is seeded.
3. **Authentication** — [04-AUTHENTICATION-TESTING.md](04-AUTHENTICATION-TESTING.md).
   Every other test needs a working session.
4. **Roles and route guards** — [roles/](roles/), then
   [03-ACCESS-CONTROL-MATRIX.md](03-ACCESS-CONTROL-MATRIX.md).
   Establish that each account lands where it should before testing features.
5. **Learner-facing modules** — test centres → discovery → route access/paywall →
   playback/practice → account/progress. These need only seeded data.
6. **Instructor modules** — verification → contribute/uploads → reference routes →
   record drive → instructor dashboard/availability.
7. **Booking flow** — needs an instructor profile with availability slots (step 6).
8. **Admin modules** — review queue, users, instructors, bookings, finance.
   These need content produced by steps 5–7 to have anything to act on.
9. **Cross-module workflows** — [05-END-TO-END-WORKFLOWS.md](05-END-TO-END-WORKFLOWS.md).
10. **Negative and authorisation testing** — [06-NEGATIVE-TESTING.md](06-NEGATIVE-TESTING.md).
11. **Edge cases** — [07-EDGE-CASES.md](07-EDGE-CASES.md).
12. **Error and recovery** — [10-ERROR-AND-RECOVERY.md](10-ERROR-AND-RECOVERY.md).
13. **Responsive / accessibility** — [11-RESPONSIVE-AND-ACCESSIBILITY.md](11-RESPONSIVE-AND-ACCESSIBILITY.md).
14. **Regression checklist** — [08-REGRESSION-CHECKLIST.md](08-REGRESSION-CHECKLIST.md).

> **Order warning.** The learner free-demo-route rule is **one route per account, ever**,
> and it is claimed permanently on first playback. Once a learner account has opened a
> route, you cannot re-test "first free route" with that account without resetting the
> database. See [modules/route-detail-access-paywall.md](modules/route-detail-access-paywall.md).

---

## 4. Test case ID convention

Every test case has a stable ID so defects can be raised against it.

| Prefix | Area |
|---|---|
| `AUTH-###` | Authentication, registration, tokens, email verification, password reset |
| `ROLE-###` | Role landing and navigation per role |
| `PERM-###` | Authorisation / access control (UI, route, API, data) |
| `TC-###` | Test Centres |
| `DISC-###` | Discover / global search |
| `RTA-###` | Route detail, access decision, paywall |
| `PLAY-###` | Watch (playback) and Practice mode |
| `SUB-###` | Subscriptions, Stripe checkout, billing result |
| `ACCT-###` | Account page and profile / contact details |
| `PROG-###` | Progress and route history |
| `BOOK-###` | Learner booking flow |
| `INST-###` | Instructor dashboard, profile, availability |
| `IVER-###` | Instructor (ADI) verification application |
| `UPL-###` | Contribute / upload wizard |
| `JRN-###` | Record a drive / journeys |
| `REF-###` | Reference routes (R1) |
| `ADM-RQ-###` | Admin — Review Queue |
| `ADM-USR-###` | Admin — Users |
| `ADM-INS-###` | Admin — Instructors |
| `ADM-BKG-###` | Admin — Bookings |
| `ADM-FIN-###` | Admin — Revenue, Community Fund, Instructor Earnings, Reports |
| `API-###` | API-only modules with no web UI (notifications, offline, community, fund, webhooks) |
| `E2E-###` | Cross-module end-to-end workflows |
| `NEG-###` | Negative scenarios |
| `EDGE-###` | Edge cases |
| `ERR-###` | Error handling and recovery |
| `UI-###` | Responsive / layout |
| `A11Y-###` | Accessibility |

---

## 5. How to record results

Copy the table for the module you are testing and add two columns:

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result | **Actual** | **P/F** |
|---|---|---|---|---|---|---|---|

Raise a defect with: **Test ID**, environment (local / deployed), role and account used,
steps, expected vs actual, screenshot, and the browser console + API response if the
failure was a server error.

---

## 6. Conventions used in these documents

- **Route** has two meanings. A *driving route* is the product's content (a recorded
  drive). A *URL route* is a page path. Documents say "driving route" or "URL path" when
  ambiguity is possible.
- `Needs Clarification` — the implementation does not determine the expected behaviour.
  Do not pass or fail these; escalate them to the development team.
- `Potential Issue` — the code suggests a problem. Confirm by test before raising a bug.
- Code references are clickable and relative to the repository root.
</content>
</invoke>
