# Module — Account & Profile

**Prefix:** `ACCT-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | The signed-in user's own settings: display name, contact details, emergency contact, subscription status, role-specific shortcuts, GDPR export/erasure and sign-out. |
| **Web path** | `/account` |
| **Entry point** | "Account" in both the desktop nav and the mobile tab bar |
| **API** | `GET /api/users/me` · `PATCH /api/users/me` · `DELETE /api/users/me/contact` · `GET`/`POST /api/users/me/test-details` · `POST /api/users/me/export` · `DELETE /api/users/me` · `GET /api/subscriptions/me` |
| **Roles** | All. The page's **content** varies by role |
| **Components** | [AccountPage.tsx](../../apps/web/src/pages/AccountPage.tsx) |
| **Backend** | [users.controller.ts](../../apps/api/src/modules/users/users.controller.ts) · [users.service.ts](../../apps/api/src/modules/users/users.service.ts) · [phone.ts](../../apps/api/src/common/validation/phone.ts) |
| **Dependencies** | Subscriptions (Premium panel) · Community (the "Become an instructor" call to action) |

---

## Role-conditional rendering — this is the main thing to test

`AccountPage` branches on `isStaff` (= `instructor` or `admin`) and
`canApplyAsInstructor` (= `user` or `contributor`):

| Role | Sections shown |
|---|---|
| `user`, `contributor` | Premium panel · contact details · **Book a lesson** · **My progress** · **Become an instructor** (with a button to `/contribute/instructor`) · Install app · Sign out |
| `instructor`, `admin` | Premium panel · contact details · **My lessons** (→ `/instructors/me`) · **Contribute** (→ `/contribute`) · Install app · Sign out. **No** "Become an instructor" block |
| `moderator` | Falls into **neither** branch — `isStaff` is false and `canApplyAsInstructor` is false. Verify what actually renders (`ACCT-016`) |

---

## Business rules found in the implementation

1. **Contact fields have three distinct states.** Absent from the payload → unchanged;
   sent as an **empty string** → **cleared**; sent with a value → stored. This is the only
   way a user can withdraw a phone number. A partial form submit must not wipe fields it
   never displayed.
2. **Phone numbers are normalised** before storage and validated by shape, accepting
   `07700 900123`, `+44 7700 900123` and `(01234) 567890`.
3. `displayName` minimum length **2**; `emergencyContactName` maximum **120** characters.
4. **`DELETE /api/users/me/contact`** clears all three contact fields in one call.
5. **GDPR erasure** (`DELETE /api/users/me`) is immediate and irreversible for the
   account: it records a `data_requests` row, **revokes every refresh token**, sets
   `email = NULL`, `display_name = 'Deleted user'`, clears the avatar and password hash,
   and sets `deleted_at`. Media purging is a **TODO** and does not happen.
6. **GDPR export** records a `data_requests` row with status `pending` and returns
   `{status:'accepted', requestId}`. **Assembling the export is a TODO — no file is ever
   produced.** Do not raise "no download appeared" as a bug; it is an unimplemented
   feature ([13](../13-TESTING-GAPS.md)).
7. **Test details** (`test_centre_id` + `test_date`) are stored as *history*; the newest
   row is "current". No web page writes them any more — the Phase 19b gate was retired —
   so this is an **API-only** surface.

---

## UI components

Back/heading "Account" · Premium status panel with an **upgrade** button for free users ·
**Mobile number** input (`placeholder="e.g. 07700 900123"`) · **Emergency contact name** ·
**Emergency contact number** · a save button · inline `.error` message · role-conditional
action cards · **Install app** button (PWA prompt) · **Sign out** button.

---

## Functional test cases

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ACCT-001 | Account page loads | any | Signed in | Open `/account` | Email/display name, subscription status and contact fields render with current values |
| ACCT-002 | Save a mobile number | user | — | Enter `07700 900123` → Save | Saved; persists across a page refresh; stored normalised |
| ACCT-003 | Save in international format | user | — | Enter `+44 7700 900123` → Save | Accepted |
| ACCT-004 | Save in bracketed format | user | — | Enter `(01234) 567890` → Save | Accepted |
| ACCT-005 | Reject an invalid phone | user | — | Enter `abcdef` → Save | Inline error with the phone-format message; nothing saved |
| ACCT-006 | Save emergency contact details | user | — | Fill name + number → Save | Both persist |
| ACCT-007 | **Clear one field only** | user | Phone and emergency name both set | Clear the **phone** field only → Save | Phone is cleared; the **emergency name is untouched**. If the other fields are wiped, that is a defect against rule 1 |
| ACCT-008 | Emergency name too long | user | — | Enter 130 characters | **400** (max 120) |
| ACCT-009 | Display name too short | user | — | `PATCH /api/users/me` with `{"displayName":"A"}` | **400** (min 2) |
| ACCT-010 | Unknown field is rejected | user | — | `PATCH /api/users/me` with `{"role":"admin"}` | **400** — the global validation pipe uses `forbidNonWhitelisted`. **A 200 that changes the role is a critical privilege-escalation defect** |
| ACCT-011 | Clear all contact details | user | Details set | `DELETE /api/users/me/contact` | All three fields become null; `GET /api/users/me` confirms |
| ACCT-012 | Premium panel — free user | user | Free plan | Open `/account` | Shows an upgrade prompt; the button navigates to `/paywall` |
| ACCT-013 | Premium panel — premium user | admin | Universal premium | Open `/account` | Shows the active plan; no upgrade prompt |
| ACCT-014 | Learner sees the instructor call to action | user / contributor | — | Open `/account` | A **Become an instructor** block with a button to `/contribute/instructor` |
| ACCT-015 | Instructor / admin sees the staff shortcuts | instructor / admin | — | Open `/account` | **My lessons** → `/instructors/me` and **Contribute** → `/contribute`. **No** "Become an instructor" block |
| ACCT-016 | **Moderator account page** | moderator | Moderator account created | Open `/account` | Record exactly what renders. The code has no branch for `moderator`, so neither the staff shortcuts nor the "Become an instructor" block should appear. Confirm the page is still usable — `Needs Clarification` |
| ACCT-017 | Sign out | any | — | Click **Sign out** | Tokens cleared, redirected to `/login`, protected pages no longer reachable |
| ACCT-018 | Install app | any | A browser supporting the PWA install prompt | Click **Install app** | The browser install prompt appears, or the button is disabled/absent when unsupported — never a silent no-op with no feedback |
| ACCT-019 | **GDPR export** | user | Use a throwaway account | `POST /api/users/me/export` | **200** `{status:'accepted', requestId}`; a `data_requests` row with `kind='export'`, `status='pending'`. **No file is produced** — that is unimplemented, not a bug |
| ACCT-020 | **GDPR erasure** | user | **Throwaway account only — this is irreversible** | `DELETE /api/users/me` | `{status:'accepted'}`; the user row has `email = NULL`, `display_name = 'Deleted user'`, `deleted_at` set; all refresh tokens revoked |
| ACCT-021 | Erased account cannot sign in | user | ACCT-020 done | Try to sign in with the old email | Fails — the email no longer exists on any account |
| ACCT-022 | Erased account disappears from admin | admin | ACCT-020 done | Admin → Users, search for it | Absent (the list filters `deleted_at IS NULL`) and the user count drops |
| ACCT-023 | Erased account's routes | admin | The erased user contributed a published route | Open `/discover` | Record what the instructor byline shows. Contributed routes are **not** removed by erasure — confirm the intended behaviour (`Needs Clarification`) |
| ACCT-024 | **API** — test details round trip | user | A valid test-centre id | `POST /api/users/me/test-details` with `{testCentreId, testDate:"2026-09-14"}`, then `GET` | The POST returns the created record; the GET returns `{current, history}` with the new row as `current` |
| ACCT-025 | **API** — invalid test details | user | — | `POST` with `testCentreId:"abc"` or `testDate:"not-a-date"` | **400** |
| ACCT-026 | Another user's profile is unreachable | user | Know another user's id | Look for any endpoint that returns another user's profile | There is none outside `/api/admin/users`. Confirm `GET /api/users/me` always returns **only** the caller |
| ACCT-027 | Unauthenticated access | — | No token | `GET /api/users/me` | **401** |

---

## Traceability

| Test IDs | UI | API | Logic |
|---|---|---|---|
| ACCT-001, ACCT-026, ACCT-027 | `AccountPage.tsx` | `GET /api/users/me` | `UsersService.me()` |
| ACCT-002 … ACCT-011 | contact form | `PATCH /api/users/me`, `DELETE /api/users/me/contact` | `updateProfile()`, `normalisePhone()` |
| ACCT-012, ACCT-013 | Premium panel | `GET /api/subscriptions/me` | `mySubscription()` |
| ACCT-014 … ACCT-016 | role branches | — | `isStaffRole()`, `canApplyAsInstructor()` |
| ACCT-019 … ACCT-023 | *(API only)* | `POST /api/users/me/export`, `DELETE /api/users/me` | `requestExport()`, `requestErasure()` |
| ACCT-024, ACCT-025 | *(API only)* | `/api/users/me/test-details` | `getTestDetails()`, `addTestDetails()` |
</content>
