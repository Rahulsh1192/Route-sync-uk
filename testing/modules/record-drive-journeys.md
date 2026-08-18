# Module — Record a Drive (Journeys & R1 Conformance)

**Prefix:** `JRN-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | An instructor records a live GPS track in the browser while driving a reference route (R1). The track is matched against the R1 and given a **verdict**; dashcam footage can then be attached to that journey. |
| **Web path** | `/contribute/record` |
| **Entry point** | The **Record a drive** button on `/contribute` (staff branch only) |
| **API** | `POST /api/journeys` · `POST /api/journeys/:id/check` · `POST /api/journeys/:id/submit` · `GET /api/journeys/:id` · `GET /api/instructors/me/journeys` · `POST /api/internal/journeys/analyse-upload` (worker only) |
| **Roles** | `instructor`, `admin` for start/check/submit/list. `GET /api/journeys/:id` is available to any authenticated user but is owner- or staff-scoped |
| **Components** | [RecordDrivePage.tsx](../../apps/web/src/pages/contribute/RecordDrivePage.tsx) |
| **Backend** | [journeys.controller.ts](../../apps/api/src/modules/journeys/journeys.controller.ts) · [journeys.service.ts](../../apps/api/src/modules/journeys/journeys.service.ts) · [matching.ts](../../apps/api/src/modules/journeys/matching.ts) |
| **Dependencies** | A **reference route (R1)** must exist · **browser geolocation permission** · `platform_config` rows `journey_*` tune the thresholds · consumed by the upload wizard as the `app_journey` GPS source |

---

## ⚠ Testing constraints

- **Geolocation is required.** The browser must grant location permission, and the device
  must actually move for a meaningful track. Testing this properly needs either a real
  drive or a geolocation-mocking tool (Chrome DevTools → Sensors → Location, or a
  Selenium/Playwright geolocation override).
- **The API path is fully testable without driving.** `POST /api/journeys/:id/submit`
  accepts a `fixes` array, so you can post a synthetic track derived from the R1's own
  coordinates. This is the practical way to test conformance verdicts.
- A sample GPX exists at
  [docs/new developments/22_Jul_2026_8_25_30_am (1).gpx](<../../docs/new developments/22_Jul_2026_8_25_30_am (1).gpx>).

---

## Business rules found in the implementation

1. **Conformance thresholds** come from `DEFAULT_MATCH_OPTIONS` and can be overridden per
   deployment by `platform_config` keys `journey_deviation_m`,
   `journey_deviation_sustain_m`, `journey_min_coverage_pct`, `journey_gap_m`,
   `journey_reentry_tolerance_m`:

   | Option | Default | Meaning |
   |---|---|---|
   | `deviationM` | **30 m** | Cross-track distance that counts as off-route |
   | `sustainM` | **50 m** | Off-route travel before it is a real deviation rather than GPS noise |
   | `gapM` | **75 m** | An uncovered R1 stretch this long counts as a coverage gap |
   | `reentryToleranceM` | **35 m** | How close a re-entry must be to the exit point |
   | `minCoveragePct` | **98 %** | R1 coverage required to auto-pass |
   | `searchWindowM` | **200 m** | How far ahead of the last match to look |
   | `backToleranceM` | **25 m** | Small backward jitter allowed |

2. **The verdict is `verified` or `rejected`.** The engine is **pure and deterministic** —
   the same track always produces the same verdict.
3. **Track size limits:** fewer than **2** fixes → `400 Journey has too few GPS points`;
   more than **200 000** fixes → `400 GPS track is too large`.
4. **Sanity filtering:** non-finite coordinates are dropped, fixes are sorted by `tMs`,
   and a jump beyond `45 m/s × Δt + 40 m` is treated as a teleport/skip rather than
   genuine movement.
5. **Ownership:** start/check/submit require the journey to belong to the caller —
   `403 Not your journey`. `GET /api/journeys/:id` additionally allows **staff**.
6. **Live check** returns whether the current position is within `deviationM` of the R1,
   using a forward search window, so the app can warn the driver in real time.
7. **`videoSource`** is one of `phone`, `dashcam`, `dual`.
8. **The worker's internal endpoint** re-runs the same engine on an upload's merged GPS
   track and is protected by `WorkerSecretGuard`.

---

## UI components

Back button to `/contribute` · H1 "Record a drive" · a **verified instructors only**
message with a button to `/contribute/instructor` for non-staff · test-centre select ·
reference-route select (filtered by centre) · **Start** button (disabled until an R1 is
chosen) · a live recording panel showing the fix count and any deviation warning ·
a GPS-error banner · **Finish** and **Discard** buttons · a result panel with the verdict
and coverage, plus a button onward to `/contribute/upload`.

---

## Functional test cases

### The browser flow

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| JRN-001 | Page loads for staff | instructor | — | `/contribute` → **Record a drive** | Centre and reference-route selects render |
| JRN-002 | Page is gated for learners | user | — | Type `/contribute/record` | The "verified instructors only" message and a button to `/contribute/instructor` — no recording controls |
| JRN-003 | R1 list is scoped to the centre | instructor | R1s exist for two centres | Change the centre select | The R1 list reloads for that centre |
| JRN-004 | **Start** requires an R1 | instructor | — | Leave the R1 unchosen | **Start** is disabled |
| JRN-005 | Start a journey | instructor | R1 chosen; geolocation allowed | Click **Start** | `POST /api/journeys` returns a journey id; the recording panel appears and the fix count begins increasing |
| JRN-006 | **Geolocation denied** | instructor | Deny the browser location prompt | Click **Start** | A readable GPS error is shown. The page must not hang or silently record nothing |
| JRN-007 | Live deviation warning | instructor | Mock a location well off the R1 | Move the mocked position > 30 m from the route | A deviation warning appears |
| JRN-008 | Finish and submit | instructor | A recording in progress with ≥ 2 fixes | Click **Finish** | `POST /api/journeys/:id/submit`; a verdict and coverage percentage are shown |
| JRN-009 | Discard | instructor | A recording in progress | Click **Discard** | The recording is abandoned; nothing is submitted; the page returns to the start state |
| JRN-010 | Continue to upload | instructor | A submitted journey | Click the button to `/contribute/upload` | The wizard opens. Choosing **I recorded the GPS in the Test Routify app** offers this journey |
| JRN-011 | Browser refresh mid-recording | instructor | Recording in progress | Press F5 | Record what happens — the in-memory track is expected to be lost and the journey left open. Confirm it can be discarded or re-used and does not block a later upload |

### Conformance (API-driven — the practical path)

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| JRN-012 | **A track that follows the R1 passes** | instructor | An R1 exists; start a journey via `POST /api/journeys` | Submit `fixes` sampled directly from the R1's own coordinates with increasing `tMs` | `verdict: "verified"`, coverage ≥ 98 % |
| JRN-013 | **A track that leaves the route fails** | instructor | Same journey setup | Submit a track that diverges > 30 m for > 50 m of travel and never covers part of the R1 | `verdict: "rejected"` with a reason; coverage below the threshold |
| JRN-014 | **Partial coverage fails** | instructor | — | Submit fixes covering only the first half of the R1 | Coverage ≈ 50 %, `verdict: "rejected"` |
| JRN-015 | Small GPS noise does **not** fail | instructor | — | Submit an on-route track with ±20 m jitter (below `deviationM`) | Still `verified` — jitter under 30 m is not a deviation |
| JRN-016 | Brief excursion under `sustainM` | instructor | — | Submit a track that goes 40 m off-route for only ~20 m of travel | Not counted as a real deviation |
| JRN-017 | **Determinism** | instructor | — | Submit the identical track to two separate journeys | Identical verdict, coverage and deviation figures |
| JRN-018 | Threshold override | admin then instructor | `INSERT INTO platform_config(key,value) VALUES('journey_min_coverage_pct','50')` | Re-submit the JRN-014 track | It now passes — the DB-tunable threshold takes effect |
| JRN-019 | Too few points | instructor | — | Submit `fixes` with one entry | **400 Journey has too few GPS points** |
| JRN-020 | Too many points | instructor | — | Submit 200 001 fixes | **400 GPS track is too large** |
| JRN-021 | Out-of-range coordinates | instructor | — | Submit a fix with `lat: 95` | **400** — DTO range validation |
| JRN-022 | Negative timestamp | instructor | — | Submit a fix with `tMs: -1` | **400** (`@Min(0)`) |
| JRN-023 | Teleport is filtered | instructor | — | Insert a fix 50 km away with a 1-second gap, in the middle of a good track | The jump is treated as a teleport/skip rather than genuine movement; the verdict reflects a coverage gap, not a wild deviation |
| JRN-024 | Live check | instructor | An open journey | `POST /api/journeys/:id/check` with an on-route point, then an off-route point | On-route → within tolerance; off-route → a deviation is reported |
| JRN-025 | Journey report | instructor | A submitted journey | `GET /api/journeys/:id` | Verdict, coverage, deviations and any reject reason |
| JRN-026 | Own journeys list | instructor | — | `GET /api/instructors/me/journeys` | Only the caller's journeys |

### Authorisation

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| JRN-027 | Learner cannot start a journey | user | Learner token | `POST /api/journeys` | **403 Insufficient role** |
| JRN-028 | Moderator cannot start a journey | moderator | Moderator token | `POST /api/journeys` | **403** |
| JRN-029 | **Submit someone else's journey** | instructor | Another instructor's journey id | `POST /api/journeys/<their id>/submit` | **403 Not your journey** |
| JRN-030 | **Read someone else's journey** | instructor | Another instructor's journey id | `GET /api/journeys/<their id>` | **403 Not your journey** |
| JRN-031 | Staff can read any journey | admin / moderator | Any journey id | `GET /api/journeys/<id>` | **200** — staff are explicitly allowed |
| JRN-032 | Non-existent journey | instructor | — | `GET /api/journeys/00000000-0000-0000-0000-000000000000` | **404 Journey not found** |
| JRN-033 | **Worker endpoint — no secret** | — | — | `POST /api/internal/journeys/analyse-upload` with no `x-worker-secret` | **403 Missing worker credentials** |
| JRN-034 | **Worker endpoint — wrong secret** | — | `WORKER_SHARED_SECRET` set | Send a wrong `x-worker-secret` | **403 Invalid worker credentials** |
| JRN-035 | **Worker endpoint — unconfigured** | — | `WORKER_SHARED_SECRET` unset | Any call | **503 Internal worker API is not configured** — the endpoint must be **closed**, never open. Anything that succeeds here is a **critical security defect** |
| JRN-036 | Worker endpoint — valid secret | — | Secret set | Send the correct header with a valid `uploadId` | **200** with the verdict and snapped timeline |

---

## Traceability

| Test IDs | UI | API | Guard | Logic |
|---|---|---|---|---|
| JRN-001 … JRN-011 | `RecordDrivePage.tsx` | `POST /api/journeys`, `/:id/check`, `/:id/submit` | `@Roles('instructor','admin')` | `startJourney()`, `liveCheck()`, `submitJourney()` |
| JRN-012 … JRN-023 | *(API only)* | `POST /api/journeys/:id/submit` | — | `analyseJourney()` in `matching.ts`, `DEFAULT_MATCH_OPTIONS` |
| JRN-018 | — | — | — | `matchOptions()` reading `platform_config` |
| JRN-025, JRN-026, JRN-029 … JRN-032 | — | `GET /api/journeys/:id`, `/api/instructors/me/journeys` | ownership + staff | `getJourney()`, `ownedJourney()` |
| JRN-033 … JRN-036 | *(worker only)* | `POST /api/internal/journeys/analyse-upload` | `WorkerSecretGuard` | `analyseUploadTrack()` |
</content>
