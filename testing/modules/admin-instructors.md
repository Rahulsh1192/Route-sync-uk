# Module — Admin: Instructors (ADI Verification Review)

**Prefix:** `ADM-INS-###`

The applicant's side is in [instructor-verification.md](instructor-verification.md).

---

## Module overview

| | |
|---|---|
| **Purpose** | Review pending ADI applications, inspect the badge evidence, and approve or reject. Approval is what promotes an account to `instructor`. |
| **Web path** | `/admin` → **Instructors** |
| **API** | `GET /api/admin/instructors` · `GET /api/admin/instructors/:id/evidence` · `POST /api/admin/instructors/:id/verify` |
| **Roles** | `moderator`, `admin` — including the approve/reject action |
| **Components** | [admin/panels/Instructors.tsx](../../apps/web/src/admin/panels/Instructors.tsx) |
| **Backend** | [admin.service.ts](../../apps/api/src/modules/admin/admin.service.ts) — `pendingInstructors()`, `instructorEvidenceUrl()`, `verifyInstructor()` |
| **Dependencies** | Object storage (signed evidence links) · Community (`onInstructorVerified`) · Users (role change) · Bookings (a verified instructor becomes bookable) |

---

## Preconditions

- Signed in as `admin@routesync.uk` or a moderator.
- The seed provides **3** pending applications (James Carter, Priya Sharma, Tom Briggs).
- **None of the seeded applications has an uploaded photo**, so the evidence link returns
  404 for all three. To test the signed evidence path, first submit a fresh application
  with a real photo (`IVER-006`).

---

## Business rules found in the implementation

1. **The list shows only `status = 'pending'` applications**, oldest first, joined to the
   applicant's display name, email and phone.
2. **`hasEvidenceFile`** is returned as a boolean — the object key itself is never sent to
   the client.
3. **`adiExpired`** is computed server-side (`adi_expiry IS NOT NULL AND adi_expiry <
   CURRENT_DATE`), so a moderator does not have to read a raw date. Submissions predating
   the expiry field have `adi_expiry = NULL`, which is shown as neither valid nor expired.
4. **The evidence link is fetched on demand and expires in 300 seconds.** It is not
   embedded in the list, precisely so a URL granting access to an identity document does
   not outlive the moment it is looked at.
5. **No uploaded photo → 404** `This application has no uploaded badge photo`.
6. **Approve (`verified`)** writes, in one transaction: the verification row
   (`status`, `reviewed_by`, `review_notes`, `reviewed_at`), and an upsert on
   `contributors` copying `instructor_status`, `verified_at`, `adi_number` and
   `adi_expiry`. It then sets **`users.role = 'instructor'`** and calls
   `onInstructorVerified()`.
7. **Reject (`rejected`)** writes the same verification and contributor rows but
   **does not change `users.role`**, and `verified_at` is set to NULL. `COALESCE` on the
   upsert means a rejection **must not erase** ADI details from an earlier valid approval.
8. **Only `verified` and `rejected` are valid decisions** (`@IsIn`).
9. **The nav badge polls the pending count every 60 seconds** — this exists specifically
   so an application is not invisible until someone opens the panel.

---

## UI components

Pending-application list — applicant name, email, phone, ADI number, expiry with an
**expired** indicator, submission date · a **view evidence** button (disabled while
opening) that fetches a signed URL and opens it · a notes input · **Approve** and
**Reject** buttons · loading, empty ("no pending applications") and error states.

---

## Functional test cases

### Review

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-INS-001 | Panel loads with pending applications | admin | Seeded | `/admin` → **Instructors** | 3 applications listed, **oldest first**: James Carter (`ADI78341`), Priya Sharma (`ADI22198`), Tom Briggs (`ADI56712`) |
| ADM-INS-002 | Nav badge count | admin | Seeded | Look at the sidebar | The Instructors badge shows **3** |
| ADM-INS-003 | Applicant contact details shown | admin | — | Inspect a row | Display name, email and phone are shown |
| ADM-INS-004 | **Expired badge is flagged** | admin | Set one application's `adi_expiry` to a past date | Reload the panel | That row is visibly marked as expired |
| ADM-INS-005 | **Missing expiry** | admin | Seeded applications have `adi_expiry = NULL` | Inspect a seeded row | Neither valid nor expired — the absence is itself visible, not rendered as valid |
| ADM-INS-006 | **Evidence link — application with a photo** | admin | Complete `IVER-006` first | Click **view evidence** | A signed URL opens the photo. Confirm it is **not** a public URL and that it stops working after ~5 minutes (`ADM-INS-008`) |
| ADM-INS-007 | **Evidence link — no photo** | admin | Any seeded application | Click **view evidence** | **404 This application has no uploaded badge photo**, shown as a readable message |
| ADM-INS-008 | **Evidence link expires** | admin | ADM-INS-006 done | Copy the signed URL, wait > 5 minutes, then open it | Access is refused. A link that still works after the TTL is a **security defect** |
| ADM-INS-009 | Non-existent application | admin | — | `GET /api/admin/instructors/00000000-0000-0000-0000-000000000000/evidence` | **404 Verification not found** |

### Decisions

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-INS-010 | **Approve an application** | admin | James Carter's application | Add notes → **Approve** | The application leaves the list; the badge count drops to 2; `instructor_verifications.status = 'verified'` with `reviewed_by`, `review_notes` and `reviewed_at` set |
| ADM-INS-011 | Approval promotes the account | admin then applicant | ADM-INS-010 done | `SELECT role FROM users WHERE email='james.carter@example.com';` then sign in as that account | Role is **`instructor`**; after signing in they get the staff navigation and can reach `/contribute/upload` |
| ADM-INS-012 | Approval copies the ADI details | admin | ADM-INS-010 done | `SELECT instructor_status, adi_number, adi_expiry, verified_at FROM contributors WHERE user_id=…;` | `verified`, the ADI number, the expiry, and a `verified_at` timestamp |
| ADM-INS-013 | Approval awards community standing | admin | ADM-INS-010 done | `GET /api/contributors/<userId>` | `onInstructorVerified()` has run — check for any badge or reputation change |
| ADM-INS-014 | **Reject an application** | admin | Tom Briggs's application | **Reject** with notes | Status `rejected`; it leaves the list; **`users.role` is unchanged** (still `contributor`); `verified_at` is NULL |
| ADM-INS-015 | **Rejection does not erase earlier ADI details** | admin | Approve an application, then submit and reject a *later* one for the same user | Check `contributors` | `adi_number` and `adi_expiry` from the valid approval are **still present** — the `COALESCE` on the upsert protects them |
| ADM-INS-016 | Invalid decision value | admin | — | `POST /api/admin/instructors/<id>/verify` with `{"decision":"maybe"}` | **400** |
| ADM-INS-017 | Decide a non-existent application | admin | — | `POST` with a random UUID | **404 Verification not found** |
| ADM-INS-018 | **Re-decide an already-decided application** | admin | ADM-INS-010 done | `POST` the same id again with `{"decision":"rejected"}` | There is **no state guard** — the decision is applied and the user is *not* demoted (rejection never touches `users.role`), leaving `role = instructor` with `instructor_status = rejected`. Confirm and raise as `Potential Issue` (see [13](../13-TESTING-GAPS.md)) |
| ADM-INS-019 | Verified instructor becomes bookable | applicant then user | ADM-INS-011 done; the new instructor saves a profile (`INST-003`) | Search on `/instructors/find` | They appear — in `elsewhere` until they set a base postcode |
| ADM-INS-020 | Empty state | admin | Decide all three applications | Reload the panel | Friendly empty state; the nav badge disappears |
| ADM-INS-021 | Badge polling | admin | Console open on another panel | Submit a new application from another browser and wait ~60 s | The Instructors badge increments without a page reload |

### Authorisation

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-INS-022 | **Moderator can approve** | moderator | Moderator account | Approve an application | **200** — deliberately allowed at `@Roles('moderator','admin')`. Verify the promoted role is still applied correctly |
| ADM-INS-023 | Moderator can view evidence | moderator | An application with a photo | Click **view evidence** | A signed URL is returned |
| ADM-INS-024 | Learner cannot read the list | user | Learner token | `GET /api/admin/instructors` | **403** |
| ADM-INS-025 | **Instructor cannot self-approve** | instructor | Their own pending application id | `POST /api/admin/instructors/<id>/verify` with `{"decision":"verified"}` | **403**. A 200 here is a **critical defect** — self-verification would bypass the whole ADI check |
| ADM-INS-026 | **Evidence is not publicly reachable** | user | An application with a photo; the object key if you can obtain it | Try to fetch the object directly from storage without a signature | Refused. Badge photos are identity documents — a publicly readable object is a **critical data-protection defect** |
| ADM-INS-027 | Unauthenticated | — | No token | `GET /api/admin/instructors` | **401** |

---

## Traceability

| Test IDs | UI | API | Guard | Logic |
|---|---|---|---|---|
| ADM-INS-001 … ADM-INS-005, ADM-INS-020 … ADM-INS-024 | `panels/Instructors.tsx` | `GET /api/admin/instructors` | `@Roles('moderator','admin')` | `pendingInstructors()` |
| ADM-INS-006 … ADM-INS-009, ADM-INS-026 | evidence button | `GET /api/admin/instructors/:id/evidence` | same | `instructorEvidenceUrl()`, `presignDownload(key, 300)` |
| ADM-INS-010 … ADM-INS-019, ADM-INS-025 | Approve / Reject | `POST /api/admin/instructors/:id/verify` | same | `verifyInstructor()`, `onInstructorVerified()` |
| ADM-INS-002, ADM-INS-021 | sidebar badge | `GET /api/admin/analytics` | same | `analytics().pendingInstructors` |
</content>
