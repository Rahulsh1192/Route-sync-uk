# Module — Test Centres

**Prefix:** `TC-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | Browse and search DVSA test centres; each centre owns the driving routes recorded around it. This is the **default landing page** for every non-admin role. |
| **Web paths** | `/test-centres` · `/test-centres/new` · `/test-centres/:id` · `/test-centres/:id/edit` |
| **Entry point** | First item in both the desktop header nav and the mobile bottom tab bar; also the post-login landing for `user`, `contributor`, `instructor` |
| **API** | `GET /api/test-centres?q=` · `GET /api/test-centres/:id` · `GET /api/test-centres/lookup/postcode` · `POST /api/test-centres` · `PATCH /api/test-centres/:id` · `DELETE /api/test-centres/:id` |
| **Roles — read** | Any authenticated user (the API itself is unauthenticated for reads) |
| **Roles — write** | `instructor`, `admin` only (`@Roles('instructor','admin')`). **`moderator` is excluded.** |
| **Components** | [TestCentresPage.tsx](../../apps/web/src/pages/TestCentresPage.tsx) · [TestCentreDetailPage.tsx](../../apps/web/src/pages/TestCentreDetailPage.tsx) · [TestCentreFormPage.tsx](../../apps/web/src/pages/TestCentreFormPage.tsx) · [RouteCard.tsx](../../apps/web/src/components/RouteCard.tsx) |
| **Backend** | [test-centres.controller.ts](../../apps/api/src/modules/test-centres/test-centres.controller.ts) · [test-centres.service.ts](../../apps/api/src/modules/test-centres/test-centres.service.ts) · [postcode.service.ts](../../apps/api/src/modules/geo/postcode.service.ts) |
| **Dependencies** | **postcodes.io** (external) for geocoding · Routes module (a centre's detail page lists its published routes) |

---

## Preconditions

- Signed in (the web app has no anonymous mode).
- Database seeded — ~45 centres exist.
- For write tests: signed in as `instructor@routesync.uk` or `admin@routesync.uk`.
- For create/edit tests: **outbound access to postcodes.io**. Without it, creation
  returns 503 by design.

## Test data

| Item | Value |
|---|---|
| Centre with routes (cannot be deleted) | **Mill Hill**, `NW7 1RB` |
| Centre with no routes (deletable) | Any centre not listed in [12 §4.2](../12-TEST-ENVIRONMENT-AND-DATA.md) — e.g. **Canterbury**, **Exeter** |
| Valid UK postcode for create | `B25 8JS`, `NW7 1RB`, `M20 2HX` |
| Invalid postcode | `ZZ99 9ZZ` |

---

## Business rules found in the implementation

1. **Centre name is unique.** A duplicate name is rejected with a conflict message
   (`assertNameFree`, plus a database unique index).
2. **The postcode is geocoded on save.** If postcodes.io is unreachable, creation fails
   with **503** and a message about the lookup service — the centre is *not* saved.
3. **Postcode is authoritative for town and region, but whatever the user typed wins.**
   The form pre-fills town/region from the lookup; a typed value overrides it.
4. **`town` is required on create** (the DTO marks it required, min 2 chars) because
   learners search and filter by town.
5. **A centre with routes cannot be deleted** — `400 This test centre still has routes.
   Reassign or remove them first.`
6. **The detail page lists only published, non-deleted routes**, ordered
   instructor-routes-first then by quality score.
7. `GET /api/test-centres/lookup/postcode` is role-gated to `instructor`/`admin`, unlike
   the other reads.

---

## UI components

| Screen | Elements |
|---|---|
| `/test-centres` | H1 "Test centres" · **+ New test centre** button (rendered **only** when `isStaff`, i.e. `instructor`/`admin`) · search input `Search by name, town or postcode…` with `aria-label="Search test centres"` · responsive card grid (1 / 2 / 3 columns at 640 px and 960 px) · per-card: name, town, postcode, route count · error banner · loading and empty states |
| `/test-centres/:id` | Back button · H1 = centre name · **Edit** and **Delete** buttons (staff only) · address / description · "Routes" heading with count · route cards (miles, difficulty, quality, instructor byline with verified badge) · empty state when the centre has no routes |
| `/test-centres/new` and `/:id/edit` | Name · Postcode (triggers the lookup) · Town · Region · Address · Description · Save · Cancel · validation messages |

---

## Functional test cases

### Read and search

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| TC-001 | Test centres is the landing page | user | Seeded | Sign in as `learner@routesync.uk` | Lands on `/test-centres`; the list renders; "Test Centres" is the active nav item |
| TC-002 | Centre list loads | any | Seeded | Open `/test-centres` | ~45 centres shown as cards, each with name, town, postcode and a route count |
| TC-003 | Search by centre name | any | — | Type `Mill Hill` | Only matching centres remain; the list filters as expected |
| TC-004 | Search by town | any | — | Type `Birmingham` | Both Birmingham centres (Great Barr, Kings Heath) are returned |
| TC-005 | Search by postcode | any | — | Type `NW7` | Mill Hill is returned |
| TC-006 | Search with no matches | any | — | Type `zzzzzz` | Empty state, **not** an error banner and not a spinner that never resolves |
| TC-007 | Clear the search | any | A search is active | Clear the input | The full list returns |
| TC-008 | Open a centre | any | — | Click the Mill Hill card | Navigates to `/test-centres/<id>`; centre details and its published routes render |
| TC-009 | A centre's route list shows only published routes | any | Mill Hill has 1 published + 1 in_review route | Open Mill Hill | The in-review route (`Mill Hill evening route (pending)`) is **not** listed |
| TC-010 | Centre with no routes | any | Open e.g. Exeter | Open the centre | Centre details render with an empty routes state, not an error |
| TC-011 | Route card content | any | — | Inspect a card on the centre page | Shows distance in **miles**, difficulty, quality, and the instructor byline (avatar, name, ✓ verified badge) |
| TC-012 | Open a route from a centre | any | — | Click a route card | Navigates to `/route/:id` — continue in [route-detail-access-paywall.md](route-detail-access-paywall.md) |
| TC-013 | Invalid centre id in the URL | any | — | Open `/test-centres/00000000-0000-0000-0000-000000000000` | A clear "not found" error is shown, not a blank page or an unhandled crash |
| TC-014 | Malformed centre id | any | — | Open `/test-centres/not-a-uuid` | Error shown gracefully. Record the exact status (the service casts to `uuid`, so a **500** here is a defect — see [13](../13-TESTING-GAPS.md)) |

### Create / edit / delete — permitted roles

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| TC-015 | "New test centre" button visibility | instructor / admin | — | Open `/test-centres` | The **+ New test centre** button is present |
| TC-016 | Create a centre | instructor | postcodes.io reachable | New → name `QA Test Centre 1`, postcode `B25 8JS`, fill town/region → Save | Centre created and appears in the list; town/region pre-filled from the postcode lookup |
| TC-017 | Postcode lookup pre-fills the form | instructor | — | Enter a valid postcode in the create form | Town and region populate automatically; a map location is derived |
| TC-018 | Typed town overrides the looked-up town | instructor | — | Enter postcode `NW7 1RB`, then type `Mill Hill` over the returned town | The saved centre keeps `Mill Hill`, not the administrative district |
| TC-019 | Edit a centre | instructor / admin | A centre you created | Open it → Edit → change the description → Save | Change persists and is visible on the detail page |
| TC-020 | Delete a centre with **no** routes | instructor / admin | `QA Test Centre 1` from TC-016 | Open it → Delete → confirm | Centre removed; redirected to `/test-centres`; it no longer appears |
| TC-021 | Delete a centre **with** routes | instructor / admin | Mill Hill | Open it → Delete | **400** — *"This test centre still has routes. Reassign or remove them first."* The centre is **not** deleted |
| TC-022 | Duplicate centre name | instructor / admin | `Mill Hill` exists | Create a centre named `Mill Hill` | Conflict error naming the duplicate; not saved. **Not** a generic 500 |
| TC-023 | Invalid postcode | instructor / admin | — | Create with postcode `ZZ99 9ZZ` | Rejected with a message about the postcode; centre not created |
| TC-024 | Name too short | instructor / admin | — | Create with name `A` | **400** validation error (min 2 characters) |
| TC-025 | Name too long | instructor / admin | — | Create with a 200-character name | **400** (max 160) |
| TC-026 | Description too long | instructor / admin | — | Enter 1 100 characters of description | **400** (max 1 000) |
| TC-027 | Missing required town | instructor / admin | — | Clear the town before saving | **400** — town is required |
| TC-028 | Postcode service unreachable | instructor / admin | Block postcodes.io (disconnect, or a firewalled network) | Attempt to create a centre | **503** with the "could not reach the postcode lookup service" message. Confirm the message is user-readable, not a stack trace |

### Authorisation — denied roles

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| TC-029 | Learner sees no create button | user / contributor | — | Open `/test-centres` | No **+ New test centre** button |
| TC-030 | Learner sees no edit/delete buttons | user / contributor | — | Open any centre detail page | No Edit and no Delete |
| TC-031 | **Route-level bypass** — learner opens the create form | user / contributor | — | Type `/test-centres/new` in the address bar | The form **renders** (there is no client-side guard). Fill it in and Save → the API returns **403 Insufficient role** and the centre is **not** created. Confirm the failure is a readable message, not a silent no-op |
| TC-032 | **Route-level bypass** — learner opens the edit form | user / contributor | Know a centre id | Open `/test-centres/<id>/edit` | Same as TC-031 — renders, save is refused with 403 |
| TC-033 | **API-level bypass** — learner creates a centre | user | Learner bearer token | `POST /api/test-centres` with a valid body | **403 Insufficient role**. A 201 here is a **critical defect** |
| TC-034 | **API-level bypass** — learner deletes a centre | user | Learner token | `DELETE /api/test-centres/<id>` | **403** |
| TC-035 | **Moderator cannot write** | moderator | Moderator account created per [12 §3.1](../12-TEST-ENVIRONMENT-AND-DATA.md) | `POST /api/test-centres` with a moderator token | **403** — moderator is deliberately not in the `@Roles` list |
| TC-036 | Moderator sees no create button | moderator | — | `/admin` → Main app → `/test-centres` | No **+ New test centre** button (moderator is not "staff" in the web app) |
| TC-037 | Postcode lookup is role-gated | user | Learner token | `GET /api/test-centres/lookup/postcode?postcode=NW7 1RB` | **403** |
| TC-038 | Unauthenticated read | — | No token | `GET /api/test-centres` with no `Authorization` header | **200** with the centre list — reads are deliberately public at API level even though the UI requires a session. Confirm this is intended (`Needs Clarification`, see [13](../13-TESTING-GAPS.md)) |

---

## Traceability

| Test IDs | UI | API | Guard | Service logic |
|---|---|---|---|---|
| TC-001 … TC-014 | `TestCentresPage.tsx`, `TestCentreDetailPage.tsx` | `GET /api/test-centres`, `GET /api/test-centres/:id` | none | `list()`, `detail()` |
| TC-015 … TC-028 | `TestCentreFormPage.tsx` | `POST`/`PATCH /api/test-centres` | `JwtAuthGuard` + `RolesGuard('instructor','admin')` | `create()`, `update()`, `assertNameFree()`, `PostcodeService.geocode()` |
| TC-020 … TC-021 | `TestCentreDetailPage.tsx` | `DELETE /api/test-centres/:id` | same | `remove()` — route-count guard |
| TC-029 … TC-038 | `isStaff` in `Layout`/pages | all of the above | `RolesGuard` | — |
</content>
