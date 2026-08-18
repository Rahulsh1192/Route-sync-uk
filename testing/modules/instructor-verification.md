# Module — Instructor (ADI) Verification

**Prefix:** `IVER-###`

The moderator/admin side of this flow is in
[admin-instructors.md](admin-instructors.md).

---

## Module overview

| | |
|---|---|
| **Purpose** | A learner applies to become a verified driving instructor by submitting their DVSA ADI badge number, its expiry date, and evidence (an uploaded photo and/or a link). |
| **Web path** | `/contribute/instructor` |
| **Entry point** | **Become an instructor** on `/account` (shown to `user` and `contributor` only); also from `/contribute` and from the "verified instructors only" message on the upload and record pages |
| **API** | `POST /api/instructors/verify/evidence-upload` · `POST /api/instructors/verify` · `GET /api/instructors/me/status` |
| **Roles** | Any authenticated role can call these endpoints; the **UI** offers the entry point to `user` and `contributor` only |
| **Components** | [InstructorVerifyPage.tsx](../../apps/web/src/pages/contribute/InstructorVerifyPage.tsx) |
| **Backend** | [community.controller.ts](../../apps/api/src/modules/community/community.controller.ts) · [community.service.ts](../../apps/api/src/modules/community/community.service.ts) |
| **Dependencies** | Object storage (MinIO/R2) for the badge photo · admin verification, which is what actually grants the `instructor` role |

---

## Preconditions

- Signed in as a `user` or `contributor` who has **no pending application**.
  The seeded contributors already have pending applications — use a fresh account.
- Object storage running, for the evidence-upload tests.

---

## Business rules found in the implementation

1. **One pending application at a time** — a second submission returns
   **409 A verification request is already pending**.
2. **ADI number uniqueness is checked explicitly** before insert, so two people claiming
   one badge get a real message rather than a 500:
   *"ADI number X is already registered to another account…"* (**409**).
3. **`adiExpiry` is required** and must be `YYYY-MM-DD`. An expiry **already in the past**
   is rejected at submission: *"That ADI badge expired on … Renew it with the DVSA…"*
   (**400**).
4. **Evidence file types:** `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
   `application/pdf`. Anything else → **400** naming the rejected type.
5. **Maximum evidence size 15 MB**, checked twice — against the declared `bytes` before
   the presigned URL is issued, and again against the object's real size at submission.
6. **The evidence key is scoped to the applicant** (`instructor-evidence/<userId>/<uuid>.<ext>`).
   Submitting a key belonging to someone else →
   **400 That evidence upload does not belong to this account.**
7. **A key with no stored object** → *"We could not find the badge photo you uploaded.
   Please attach it again."*
8. **Each upload gets a fresh random key**, so re-applying after a rejection never
   overwrites the evidence attached to the earlier decision.
9. **`evidenceUrl` (a link) and `evidenceKey` (an uploaded file) coexist** — an applicant
   who already hosts their certificate can link to it instead.
10. **Approval is what promotes the account.** `verifyInstructor(..., 'verified')` sets
    `users.role = 'instructor'` and `contributors.instructor_status = 'verified'`.
    Rejection sets `rejected` and **leaves `users.role` unchanged**.
11. **`adiNumber` minimum length 3.**

---

## UI components

Back button to `/contribute` · H1 "Instructor verification" · current-status panel ·
**ADI number** input (`placeholder="e.g. 123456"`) · **ADI expiry** date input · a badge
photo picker with per-file states (idle / uploading with a progress percentage / ready /
error) and a **clear** action · **evidence URL** input (`placeholder="https://…"`) ·
inline error banner · submit button · success message
*"Submitted — a moderator will review your ADI evidence."*

---

## Functional test cases

### Applying

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| IVER-001 | Entry point is visible to a learner | user / contributor | — | Open `/account` | A **Become an instructor** block with a button to `/contribute/instructor` |
| IVER-002 | Entry point is hidden from staff | instructor / admin | — | Open `/account` | No "Become an instructor" block |
| IVER-003 | Verification page loads | user | — | Open `/contribute/instructor` | Form renders; the current status panel shows no application |
| IVER-004 | Submit with a link only | user | Fresh account | ADI `123456`, expiry a future date, evidence URL `https://example.com/cert.pdf` → Submit | **201/200**; success message; `instructor_verifications` row with `status = 'pending'`; the admin Instructors badge count increases by 1 |
| IVER-005 | Status after submitting | user | IVER-004 done | Reload the page | The status panel shows **pending** with the submitted ADI number and expiry |
| IVER-006 | **Upload a badge photo** | user | Fresh account; storage running | Choose a JPEG under 15 MB → wait for the upload → Submit with ADI number and expiry | The file uploads with visible progress, then the application is created with an `evidence_key`. An admin can now open the signed evidence link (`ADM-INS-005`) |
| IVER-007 | Upload a PDF | user | — | Choose a PDF | Accepted |
| IVER-008 | **Reject an unsupported file type** | user | — | Choose a `.txt` or `.zip` | **400** — *"A badge photo must be a JPEG, PNG, WebP, HEIC or PDF — not …"* |
| IVER-009 | **Reject an oversized file** | user | A file > 15 MB | Choose it | **400** stating the size in MB and the 15 MB limit. The upload must be refused **before** the bytes are transferred |
| IVER-010 | Clear a chosen photo | user | A photo selected | Click the clear action | The selection is removed; the form can be submitted without it |
| IVER-011 | **Second application while one is pending** | user | IVER-004 done | Submit again | **409 A verification request is already pending** |
| IVER-012 | **Duplicate ADI number** | user | A second fresh account | Submit with `ADI12345` (the seeded verified instructor's number) | **409** — *"ADI number ADI12345 is already registered to another account…"*. **Not a 500** |
| IVER-013 | **Expired ADI badge** | user | Fresh account | Submit with an expiry date in the past | **400** — *"That ADI badge expired on …"* |
| IVER-014 | Expiry dated today | user | Fresh account | Submit with today's date | **Accepted** — the comparison is against midnight today, so today is not "past" |
| IVER-015 | Missing expiry | user | — | `POST /api/instructors/verify` with no `adiExpiry` | **400** |
| IVER-016 | Malformed expiry | user | — | `POST` with `adiExpiry: "14/09/2026"` | **400** — *"Enter the ADI badge expiry date as YYYY-MM-DD"* |
| IVER-017 | ADI number too short | user | — | Submit `12` | **400** (min 3) |
| IVER-018 | Missing ADI number | user | — | Submit with the field blank | **400** |
| IVER-019 | **Evidence key belonging to another account** | user | Two accounts; capture account B's evidence key | Submit as account A with B's `evidenceKey` | **400 That evidence upload does not belong to this account.** Anything other than a rejection is a **security defect** |
| IVER-020 | **Evidence key with no uploaded object** | user | — | Request a presigned URL but **do not** PUT the file, then submit with that key | **400** — *"We could not find the badge photo you uploaded. Please attach it again."* |
| IVER-021 | Overlong evidence key | user | — | `POST` with a 400-character `evidenceKey` | **400** (max 300) |

### After a decision

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| IVER-022 | **Approval promotes the account** | user → instructor | An admin approves the application (`ADM-INS-003`) | Sign out and sign back in, then open `/account` | The role is now `instructor`: **staff navigation** appears (Contribute, My Lessons), the "Become an instructor" block is gone, and `/contribute/upload` is usable |
| IVER-023 | **The role change needs a new token** | user | An admin approves while the applicant stays signed in | Without signing out, refresh the page | The old access token still carries `role: user`, so the UI does not change until the token is refreshed or the user signs in again. Record how long it takes and whether it confuses the user — see `EDGE-014` |
| IVER-024 | Approval creates a bookable instructor | instructor | IVER-022 done | Search on `/instructors/find` | The new instructor appears **only after** they save a profile — and only in `elsewhere` until they set a base postcode |
| IVER-025 | **Rejection does not change the role** | user | An admin rejects the application (`ADM-INS-004`) | Reload `/account` and `/contribute/instructor` | The role stays `user`/`contributor`; the status panel shows **rejected**; the staff navigation is not granted |
| IVER-026 | Re-apply after a rejection | user | IVER-025 done | Submit a new application | Accepted — the previous rejection does not block a new pending application. Confirm the earlier evidence is still attached to the old decision (a fresh random key is used) |
| IVER-027 | Expiry warning surfaces | instructor | `contributors.adi_expiry` set to a past date | `GET /api/instructors/me/status` | `adiExpired: true` is returned. **Note:** nothing in the code demotes the user or blocks bookings — see [13](../13-TESTING-GAPS.md) |
| IVER-028 | Unauthenticated | — | No token | `POST /api/instructors/verify` | **401** |
| IVER-029 | **An instructor applies again** | instructor | Already verified | `POST /api/instructors/verify` with a new ADI number | The endpoint has **no role restriction**. Record what happens and confirm the intended behaviour (`Needs Clarification`) |

---

## Traceability

| Test IDs | UI | API | Logic |
|---|---|---|---|
| IVER-001, IVER-002 | `AccountPage.tsx` | — | `canApplyAsInstructor()` |
| IVER-006 … IVER-010, IVER-019 … IVER-021 | photo picker | `POST /api/instructors/verify/evidence-upload` | `createEvidenceUpload()`, `EVIDENCE_TYPES`, `EVIDENCE_MAX_BYTES`, `assertOwnEvidence` |
| IVER-004, IVER-011 … IVER-018 | verification form | `POST /api/instructors/verify` | `submitInstructorVerification()` |
| IVER-003, IVER-005, IVER-027 | status panel | `GET /api/instructors/me/status` | `instructorStatus()` |
| IVER-022 … IVER-026 | — | `POST /api/admin/instructors/:id/verify` | `AdminService.verifyInstructor()` |
</content>
