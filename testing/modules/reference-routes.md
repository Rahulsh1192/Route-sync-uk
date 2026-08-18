# Module — Reference Routes (R1)

**Prefix:** `REF-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | An **R1** is the canonical geometry of a test-centre route. Every recorded drive is matched against one, and the upload wizard makes selecting an R1 part of publishing footage. |
| **Web path** | `/admin` → **Reference Routes** panel. There is **no learner-facing page** |
| **API** | `POST /api/reference-routes` · `GET /api/reference-routes?testCentreId=` · `GET /api/reference-routes/:id` |
| **Roles** | **Create:** `instructor`, `admin`. **Read:** any authenticated user. **`moderator` cannot create** |
| **Components** | [admin/panels/ReferenceRoutes.tsx](../../apps/web/src/admin/panels/ReferenceRoutes.tsx) |
| **Backend** | [journeys.controller.ts](../../apps/api/src/modules/journeys/journeys.controller.ts) · [journeys.service.ts](../../apps/api/src/modules/journeys/journeys.service.ts) · [matching.ts](../../apps/api/src/modules/journeys/matching.ts) |
| **Dependencies** | Test Centres (an R1 usually belongs to one) · consumed by [record-drive-journeys.md](record-drive-journeys.md) and [contribute-uploads.md](contribute-uploads.md) |

> The panel lives in the **admin console**, but the API is gated to `instructor` and
> `admin`. A moderator can open the panel and will be refused on save — see `REF-012`.

---

## Preconditions

- Signed in as `admin@routesync.uk` (or an instructor, via the API).
- At least one test centre exists.
- **The seed contains no reference routes.** You must create one before any journey or
  upload test can run.

---

## Business rules found in the implementation

1. **Minimum 2 points** — `400 A reference route needs at least 2 GPS points`.
2. **Every coordinate is validated** — `400 Reference route contains an invalid
   coordinate`. Latitude −90…90, longitude −180…180 (DTO-level).
3. **Zero total length is rejected** by the geometry engine
   (`Reference route has zero length`).
4. `name` is required, 2–160 characters. `startLabel` / `endLabel` are optional, max 160.
   `testCentreId` is optional at the API level.
5. **The R1 list is filterable by test centre**, and the upload wizard uses that filter so
   an instructor is only offered plausibly-matching R1s.
6. The panel **decimates** long point lists client-side before submitting (a stride is
   applied), so a very dense paste is thinned — the stored geometry may have fewer points
   than you pasted. That is intended.

---

## UI components

Test-centre `<select>` · route name input (`placeholder="e.g. Mill Hill Route 3"`) ·
start-label input (`placeholder="e.g. Test centre car park"`) · end-label input
(`placeholder="e.g. Back at the centre"`) · a coordinate/points input · a create button ·
the existing-R1 list for the chosen centre · success message noting that contributors can
now select it when uploading · error banner.

---

## Functional test cases

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| REF-001 | Panel loads | admin | — | `/admin` → **Reference Routes** | Centre select and the create form render; the R1 list is empty on a fresh database |
| REF-002 | List is scoped to the centre | admin | R1s exist for two centres | Switch the centre select | The list reloads and shows only that centre's R1s |
| REF-003 | Create an R1 | admin | A centre chosen | Name `Mill Hill Route 3`, paste ≥ 2 valid coordinates → Create | Created; appears in the list; the success message mentions that contributors can now select it |
| REF-004 | Start and end labels | admin | — | Fill both label fields → Create | Both are stored and shown on the R1 |
| REF-005 | **Fewer than 2 points** | admin | — | Submit with a single coordinate | **400 A reference route needs at least 2 GPS points** |
| REF-006 | **Invalid coordinate** | admin | — | Submit with `lat: 200` or `lng: 400` | **400** — either the DTO range validation or *"contains an invalid coordinate"* |
| REF-007 | Non-numeric coordinate | admin | — | Paste `abc,def` | Rejected with a readable message; nothing created |
| REF-008 | Zero-length geometry | admin | — | Submit two **identical** points | Rejected — `Reference route has zero length` |
| REF-009 | Name too short / too long | admin | — | Submit a 1-character name, then a 200-character name | **400** in both cases (2–160) |
| REF-010 | Long point list is decimated | admin | — | Paste several thousand coordinates → Create | Created. `GET /api/reference-routes/:id` returns **fewer** points than you pasted — expected, the panel applies a stride |
| REF-011 | Read an R1 | any authenticated | An R1 exists | `GET /api/reference-routes/:id` | **200** with the geometry and metadata |
| REF-012 | **Moderator cannot create** | moderator | Moderator account | Open the panel and try to create; then `POST /api/reference-routes` with a moderator token | **403 Insufficient role**. The panel does not hide the form, so confirm the failure is a readable message |
| REF-013 | **Learner cannot create** | user | Learner token | `POST /api/reference-routes` | **403** |
| REF-014 | **Instructor can create via the API** | instructor | Instructor token | `POST /api/reference-routes` | **200/201** — instructors are allowed even though the only UI is inside the admin console |
| REF-015 | Read requires a session | — | No token | `GET /api/reference-routes` | **401** |
| REF-016 | R1 appears in the upload wizard | instructor | REF-003 done for centre X | Open `/contribute/upload`, choose centre X | The new R1 is selectable in the reference-route dropdown |
| REF-017 | R1 appears in Record a drive | instructor | REF-003 done | Open `/contribute/record`, choose that centre | The R1 is selectable |
| REF-018 | Non-existent R1 | any | — | `GET /api/reference-routes/00000000-0000-0000-0000-000000000000` | **404 Reference route not found** |

---

## Traceability

| Test IDs | UI | API | Guard | Logic |
|---|---|---|---|---|
| REF-001 … REF-010, REF-012 … REF-014 | `admin/panels/ReferenceRoutes.tsx` | `POST /api/reference-routes` | `@Roles('instructor','admin')` | `createReferenceRoute()`, `ReferenceGeometry` |
| REF-002, REF-011, REF-018 | same panel | `GET /api/reference-routes` | `JwtAuthGuard` | `listReferenceRoutes()`, `getReferenceRoute()` |
| REF-016, REF-017 | `UploadPage.tsx`, `RecordDrivePage.tsx` | `GET /api/reference-routes?testCentreId=` | — | — |
</content>
