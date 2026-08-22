# Module — Contribute & Upload Wizard

**Prefix:** `UPL-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | A verified instructor publishes a driving route by uploading dashcam footage plus GPS, in a four-step wizard that confirms the clip timeline **before** any bytes are transferred. |
| **Web paths** | `/contribute` (hub) · `/contribute/upload` (wizard) · `/contribute/uploads/:id` (status) |
| **Entry point** | "Contribute" in the **staff** nav; the **Contribute** button on `/account` for staff |
| **API** | `POST /api/uploads` · `POST /api/uploads/:id/parts` · `POST /api/uploads/:id/parts/complete` · `POST /api/uploads/:id/complete` · `GET /api/uploads/:id` · `DELETE /api/uploads/:id` · `POST /api/uploads/routes/:routeId/attach-video` · `POST /api/contributors/agreement` |
| **Roles** | **`instructor`, `admin`** for every write. `GET /api/uploads/:id` has no role gate but is owner-scoped |
| **Components** | [ContributePage.tsx](../../apps/web/src/pages/contribute/ContributePage.tsx) · [UploadPage.tsx](../../apps/web/src/pages/contribute/UploadPage.tsx) · [UploadStatusPage.tsx](../../apps/web/src/pages/contribute/UploadStatusPage.tsx) · [apps/web/src/upload/](../../apps/web/src/upload/) |
| **Backend** | [uploads.controller.ts](../../apps/api/src/modules/uploads/uploads.controller.ts) · [uploads.service.ts](../../apps/api/src/modules/uploads/uploads.service.ts) · [uploads.dto.ts](../../apps/api/src/modules/uploads/dto/uploads.dto.ts) |
| **Dependencies** | Contributor **footage agreement** (blocking) · Test Centres (required) · Reference Routes (offered per centre) · Journeys (for the `app_journey` source) · object storage · Redis/BullMQ + the Python worker · `WORKER_SHARED_SECRET` for conformance |

---

## Preconditions

- Signed in as `instructor@routesync.uk` (or an admin).
- At least one **test centre** exists.
- At least one **reference route (R1)** exists for that centre — create one in
  Admin → Reference Routes first.
- Object storage running.
- **For the pipeline to progress past "queued" you need the Python worker running and
  `WORKER_SHARED_SECRET` set on both the API and the worker.** Without it,
  `POST /api/internal/journeys/analyse-upload` returns **503**, conformance is skipped and
  the route is flagged. That is configuration, not a defect.
- Real dashcam video and GPS logs, or any MP4 plus a GPX file.

---

## Business rules found in the implementation

1. **The footage agreement is blocking.** `POST /api/uploads` returns
   **403 You must accept the current contributor footage agreement before uploading**
   until `POST /api/contributors/agreement` has been called. The wizard calls it for you
   at step 3→4.
2. **Free monthly upload cap = 3.** A non-premium contributor exceeding it gets
   **403 Free upload limit reached (3/month). Upgrade to Premium for unlimited uploads.**
3. **`testCentreId` is required** (`@IsUUID()`), and `title` is required.
4. **GPS source decides what files are mandatory:**
   - `camera` → **at least one GPS log file** is required, else
     *"At least one GPS log file is required (or choose a different GPS source)"*.
   - `embedded` → at least one **front video** is required.
   - `app_journey` → a front video **and** a `journeyId` are required; the journey must
     belong to the caller, must not already have video attached, and must have a usable
     GPS track.
5. **`cameraClockOffsetMs` is limited to ±24 hours.**
6. **Per-file limits:** max **5 GB** per clip. The video format is decided from the
   **filename extension first**, and only from the declared `contentType` when the name has
   no usable extension — `File.type` comes from an OS table keyed on that extension and is
   frequently wrong, so a valid `.mp4` could arrive declared as something else and be
   refused. Accepted: `.mp4 .m4v .mov .qt .mkv .webm .avi .mpg .mpeg .ts .m2ts .mts .3gp`
   (see [video-types.ts](../../apps/api/src/modules/uploads/video-types.ts)). The file
   picker advertises exactly this list, so an unsupported file cannot be selected at all.
7. **No front video → a `map_only` route** (`has_video = false`).
8. **The route is created in `draft`** at init and moves to `processing` on complete.
   The upload moves `created` → `queued` on complete.
9. **Deduplication:** a client-supplied SHA-256 that matches an object already held means
   the file is **not transferred**. The worker re-hashes what arrives, so a forged hash
   costs the client a real upload but cannot make the system serve the wrong object.
10. **Multipart** is used for large video files; parts are signed **in batches** so a slow
    upload does not run into expired URLs — which is also what makes resume work. Part
    numbers must be between 1 and `parts_total`, and at most 10 000.
11. **Abort** releases only objects nothing else references, and is **refused** once the
    upload is `queued` or `processing`: *"That upload is already being processed"*.
12. **Ownership is enforced** on complete, status, parts and abort —
    *"Not your upload"* (**403**).
13. **`attach-video`** only works on a route that is still `map_only` and has no video,
    and also requires the footage agreement.
14. **`declaredOrdinal`** carries the human-confirmed clip order and **outranks** anything
    the worker infers from filenames or mtime.

---

## UI components

| Screen | Elements |
|---|---|
| `/contribute` | H1 "Contribute" · contributor stats — **Credits**, **Reputation**, **Published** · **staff branch:** buttons to **Upload a route** and **Record a drive** · **non-staff branch:** a "verified instructors only" message and a button to `/contribute/instructor` |
| `/contribute/upload` — **Step 1 Recording** | Title · Description · **Test centre** select (required) · **GPS source** radio group with three labelled options and an explanatory hint each · **Reference route (R1)** select, filtered to the chosen centre · **Recorded journey** select (only for `app_journey`) · Next (disabled until title ≥ 2 chars, a centre is chosen, and — for `app_journey` — a journey is chosen) |
| **Step 2 Files** | Multi-file pickers for **front**, **rear** and **GPS** · file lists with sizes · Next (disabled until at least one front file, and — for `camera` — at least one GPS file) |
| **Step 3 Review** | Detected clip order per view, reorderable · inter-clip **gap report** · video↔GPS **duration reconciliation** with a percentage and an OK/not-OK indicator · **camera clock offset** in hours · **footage agreement** checkbox · Back / Upload |
| **Step 4 Upload** | Per-file progress bars with distinct **hashing** and **uploading** phases · a list of **deduplicated** files that were never transferred · a finalising state · a link onward to the upload status page |
| `/contribute/uploads/:id` | Upload status and the pipeline stage list with per-stage state, progress and findings |
| Step bar | A four-step progress indicator; **Back** moves to the previous step (or to `/contribute` from steps 1 and 4) |

---

## Functional test cases

### Access to the module

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| UPL-001 | Contribute tab is visible to staff | instructor / admin | — | Look at the nav | **Contribute** is present |
| UPL-002 | Contribute tab is hidden from learners | user / contributor / **moderator** | — | Look at the nav | **Contribute** is absent — the slot is occupied by "Book a Lesson" |
| UPL-003 | Contribute hub for staff | instructor | — | Open `/contribute` | Credits / Reputation / Published stats, plus **Upload a route** and **Record a drive** |
| UPL-004 | Contribute hub for a learner | user | — | Type `/contribute` in the address bar | The page renders (no client guard) but shows the "verified instructors only" message and a button to `/contribute/instructor` — **not** the upload button |
| UPL-005 | Upload page for a learner | user | — | Type `/contribute/upload` | Same gated message; the wizard is not offered |
| UPL-006 | **API bypass** — learner starts an upload | user | Learner token | `POST /api/uploads` with a valid body | **403 Insufficient role** |
| UPL-007 | **API bypass** — moderator starts an upload | moderator | Moderator token | `POST /api/uploads` | **403** |

### The wizard

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| UPL-008 | Step 1 validation | instructor | — | Leave the title blank, or the centre unchosen | **Next** stays disabled |
| UPL-009 | Reference routes are scoped to the centre | instructor | R1s exist for centre A only | Choose centre A → note the R1 list. Change to centre B | The R1 list reloads and **the previously chosen R1 is cleared** |
| UPL-010 | GPS source hints | instructor | — | Select each of the three GPS sources | The hint text changes to match the selected source |
| UPL-011 | `app_journey` requires a journey | instructor | Recorded journeys exist | Choose **I recorded the GPS in the Test Routify app** but leave the journey unchosen | **Next** stays disabled |
| UPL-012 | Step 2 validation — camera source | instructor | GPS source = `camera` | Add front video but **no** GPS file | **Next** stays disabled |
| UPL-013 | Step 2 validation — no front video | instructor | Any source | Add only GPS files | **Next** stays disabled |
| UPL-014 | Step 3 shows the detected clip order | instructor | Two or more front clips | Reach step 3 | Clips are listed in detected order with their start times and durations |
| UPL-015 | Reorder clips | instructor | Two or more clips | Drag or move a clip | The order changes and is what gets submitted as `declaredOrdinal` |
| UPL-016 | Gap report | instructor | Clips with a real time gap between them | Reach step 3 | The gap between clips is reported |
| UPL-017 | Duration reconciliation | instructor | GPS source = `app_journey` with a journey whose duration is known | Reach step 3 | A video-vs-GPS percentage is shown, flagged OK at ≥ 95 % |
| UPL-018 | Clock offset | instructor | — | Set the camera clock offset to +2 hours | Accepted and sent. `PUT` ±25 hours via the API → **400** *"Camera clock offset must be within ±24 hours"* |
| UPL-019 | **Agreement checkbox is required** | instructor | Fresh contributor who has not accepted | Try to submit without ticking it | Blocked client-side. Bypass it by calling `POST /api/uploads` directly → **403** about the footage agreement |
| UPL-020 | Back navigation | instructor | On step 3 | Click Back twice | Returns to step 2, then step 1, preserving what was entered |
| UPL-021 | Upload progress | instructor | A file of a few hundred MB | Submit | A **hashing** phase with its own progress, then an **uploading** phase per file; the bar never jumps backwards |
| UPL-022 | **Deduplication** | instructor | Upload the *same* file a second time in a new upload | Submit | The file is listed as deduplicated and **no** bytes are transferred. Confirm in the Network tab |
| UPL-023 | Complete the upload | instructor | Files transferred | Let the wizard finish | `POST /api/uploads/:id/complete` returns `{status:'queued'}`; the route moves to `processing` |
| UPL-024 | Upload status page | instructor | UPL-023 done | Open `/contribute/uploads/:id` | Upload status and the pipeline stage list render |
| UPL-025 | Pipeline progresses | instructor | **Worker running** with `WORKER_SHARED_SECRET` set | Wait | Stages advance; the route eventually reaches `in_review` and appears in the admin Review Queue |
| UPL-026 | Pipeline **without** the worker secret | instructor | `WORKER_SHARED_SECRET` unset | Upload and wait | Conformance is skipped and the route is flagged. **Configuration, not a defect** — confirm the state is visible rather than silently stuck |

### Limits, errors and authorisation

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| UPL-027 | **Free monthly cap** | instructor | An instructor on the **free** plan who has already completed 3 uploads this month | Start a 4th | **403 Free upload limit reached (3/month). Upgrade to Premium for unlimited uploads.** |
| UPL-028 | Premium has no cap | instructor | Grant that instructor premium | Start a 4th upload | Allowed |
| UPL-029 | Unsupported video type | instructor | — | `POST /api/uploads` declaring `originalName: "notes.txt", contentType: "text/plain"` | **400** `"notes.txt" is not a video format we can process (the browser reported it as text/plain). Supported: .mp4, .m4v, …` |
| UPL-029a | A mislabelled `.mp4` is accepted | instructor | — | Declare `originalName: "clip.mp4", contentType: "video/webm"` | **Accepted.** The extension decides. This is the real-world case: a Windows registry entry for `.mp4` overwritten by another application makes the browser report the wrong type, and this used to refuse a valid file |
| UPL-029b | WebM and AVI are accepted | instructor | — | Declare `clip.webm` and `clip.avi` | **Accepted.** The worker transcodes everything to H.264 HLS, so these were never a technical limitation |
| UPL-029c | Name with no extension falls back to the declared type | instructor | — | Declare `originalName: "clip", contentType: "video/mp4"` | **Accepted** — covers Android share sheets, which hand over a name with no extension |
| UPL-029d | Declared type matches the PUT header | instructor | Pick any video in the web UI | Watch the network tab: compare `contentType` in `POST /api/uploads` with the `Content-Type` on the presigned PUT | **Identical.** The presigned URL is signed over this value, so any difference fails the PUT with a signature error rather than a readable message |
| UPL-030 | Oversized file | instructor | — | Declare `bytes: 6000000000` (6 GB) | **400 … too large** |
| UPL-031 | No files declared | instructor | — | `POST /api/uploads` with `files: []` | **400 No files declared** |
| UPL-032 | Missing test centre | instructor | — | `POST` with no `testCentreId` | **400** |
| UPL-033 | Camera source with no GPS file | instructor | — | `POST` with `gpsSource:"camera"` and only video files | **400** — the GPS-log message |
| UPL-034 | Embedded source with no video | instructor | — | `POST` with `gpsSource:"embedded"` and only GPS files | **400 Embedded GPS needs at least one video file to read it from** |
| UPL-035 | `app_journey` with someone else's journey | instructor | Another instructor's journey id | `POST` with that `journeyId` | **403 Not your recorded journey** |
| UPL-036 | `app_journey` with an already-used journey | instructor | A journey that already has video | `POST` with it | **400 That journey already has video attached** |
| UPL-037 | `app_journey` with no GPS track | instructor | A journey with no usable fixes | `POST` with it | **400 That journey has no usable GPS track** |
| UPL-038 | Invalid SHA-256 format | instructor | — | Declare `sha256: "NOTAHASH"` | **400 sha256 must be a lowercase hex SHA-256 digest** |
| UPL-039 | Abort an in-progress upload | instructor | Upload created, not completed | `DELETE /api/uploads/:id` | **200**; the upload becomes `failed` with `Aborted by uploader`; orphaned objects are reclaimed |
| UPL-040 | **Abort a processing upload** | instructor | Upload already `queued`/`processing` | `DELETE /api/uploads/:id` | **400 That upload is already being processed** |
| UPL-041 | **Ownership — complete someone else's upload** | instructor | Another instructor's upload id | `POST /api/uploads/<their id>/complete` | **403 Not your upload** |
| UPL-042 | **Ownership — read someone else's upload status** | instructor | Another instructor's upload id | `GET /api/uploads/<their id>` | **403 Not your upload**. This endpoint has no `@Roles` gate, so ownership is the *only* control — a 200 here is a **data-leak defect** |
| UPL-043 | **Ownership — abort someone else's upload** | instructor | — | `DELETE /api/uploads/<their id>` | **403** |
| UPL-044 | Part number out of range | instructor | A multipart upload | `POST /api/uploads/:id/parts` with `partNumbers:[0]`, then `[999999]` | **400** in both cases |
| UPL-045 | Sign parts on a non-multipart file | instructor | A small single-PUT file | `POST /api/uploads/:id/parts` for it | **400 That file is not a multipart upload** |
| UPL-046 | Empty part list | instructor | — | `POST` with `partNumbers: []` | **400 No part numbers requested** |
| UPL-047 | Interrupted upload can resume | instructor | A large multipart upload | Kill the network mid-upload, restore it, and retry | Parts can be re-signed and the upload continues. Record whether the UI actually offers a resume or forces a restart (`Needs Clarification`) |
| UPL-048 | Storage unreachable | instructor | Stop MinIO | Start an upload | A readable error, not a silent hang |
| UPL-049 | **Attach video to a map-only route** | instructor | A `map_only` route with no video | `POST /api/uploads/routes/:routeId/attach-video` | Presigned targets are returned |
| UPL-050 | Attach video to a route that already has video | instructor | A route with video | Same call | **400 Route already has video or is not in map_only state** |
| UPL-051 | Attach video without the agreement | instructor | Contributor who has not accepted | Same call | **403 You must accept the footage agreement before uploading** |
| UPL-052 | Browser refresh mid-upload | instructor | Uploading at ~50 % | Press F5 | Record what happens. The wizard holds its state in memory, so expect the upload session to be lost and an orphaned upload row to remain — confirm the nightly sweep or the abort path cleans it up |

---

## Traceability

| Test IDs | UI | API | Guard | Logic |
|---|---|---|---|---|
| UPL-001 … UPL-007 | `Layout.tsx`, `ContributePage.tsx` | `POST /api/uploads` | `@Roles('instructor','admin')` | `isStaffRole()` |
| UPL-008 … UPL-020 | `UploadPage.tsx` steps 1–3 | `GET /api/test-centres`, `/api/reference-routes`, `/api/instructors/me/journeys` | — | `step1Valid`, `step2Valid`, `analyseClips()` |
| UPL-019, UPL-051 | agreement checkbox | `POST /api/contributors/agreement` | — | `hasAcceptedAgreement()` |
| UPL-021 … UPL-026, UPL-044 … UPL-047 | step 4 | `POST /api/uploads`, `/:id/parts`, `/:id/parts/complete`, `/:id/complete` | `@Roles` | `init()`, `signParts()`, `completeMultipart()`, `complete()` |
| UPL-027, UPL-028 | — | `POST /api/uploads` | — | `enforceUploadQuota()`, `FREE_MONTHLY_UPLOAD_CAP` |
| UPL-039 … UPL-043 | — | `DELETE /api/uploads/:id`, `GET /api/uploads/:id` | ownership | `getOwned()`, `abort()` |
| UPL-049 … UPL-051 | — | `POST /api/uploads/routes/:routeId/attach-video` | `@Roles` | `attachVideo()` |
</content>
