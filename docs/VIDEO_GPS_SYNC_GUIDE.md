# Video + GPS ↔ R1 Sync — How It Works (and why you can trust it)

> A plain-English + technical guide to how a recorded drive is turned into a
> verified, watchable route. It covers **GPS processing**, **video processing**,
> and **synchronisation in every recording scenario**, and is explicit about what
> is **built today** vs **designed for the next layer**, so the confidence is real.

---

## 0. The one mental model that explains everything

**R1 (the examiner's route) is the spine. The instructor's GPS is the bridge. The
video hangs off the bridge.**

- We never show the learner the instructor's *noisy* GPS. We display **R1's exact
  geometry** (the examiner's canonical line).
- The GPS exists only to answer one question: **"at video time `t`, how far along
  R1 are we?"**
- Once we know `videoTime → distanceAlongR1 → lat/lng on R1`, the map marker,
  turn prompts and junction markers all ride the clean R1 line, perfectly in step
  with the video.

Everything below is the machinery that (a) proves the drive followed R1 and
(b) builds that `videoTime → R1` mapping.

---

## 1. The data (what we store)

Source of truth: `db/migrate_phase_23.sql` / `db/schema.sql`.

| Table | Holds | Purpose |
|---|---|---|
| `reference_routes` | R1 as a PostGIS `LineString` + length | the canonical examiner route |
| `journeys` | one recording attempt + verdict/coverage/confidence | the result of a drive |
| `journey_gps_points` | every GPS fix + its match result (`matched_arc_m`, `cross_track_m`, `on_route`) | append-only truth |
| `journey_segments` | the kept, on-route spans after splicing (`start/end t_ms`, `start/end arc_m`) | the player timeline + the video cut-list |

Tunable knobs live in `platform_config` (no redeploy):
`journey_deviation_m=30`, `journey_deviation_sustain_m=50`,
`journey_min_coverage_pct=98`, `journey_gap_m=75`,
`journey_reentry_tolerance_m=35`.

---

## 2. GPS processing — **IMPLEMENTED** (`apps/api/src/modules/journeys/matching.ts`)

This is a **pure, deterministic** engine: the same track always yields the same
verdict. That determinism is itself a confidence property — it's fully testable
and reproducible.

### 2.1 Prepare R1 (`ReferenceGeometry`)
- R1's polyline is turned into **arc-length-parameterised segments** (each segment
  knows its start distance and length, via the haversine great-circle formula).
- We build a **local planar projection** (metres east/north from R1's first point)
  so point-to-segment maths is fast and accurate at city scale.
- `pointAtArc(d)` returns the exact lat/lng at any distance `d` along R1 (this is
  what snaps the marker onto the clean line).

### 2.2 Clean the fixes
Drop non-finite coordinates, sort by time. (Poor-accuracy / cold-start fixes are
naturally handled by the matcher — a bad early fix just reads as off-route until
GPS locks.)

### 2.3 Match each fix onto R1 — **monotonic, forward-only**
For every fix we find the **nearest point on R1**, but only searching **forward**
from the last matched distance within a window. This is the key to correctness on
hard geometry:

- **Loops / out-and-back / self-crossing roads:** a naive "nearest point anywhere"
  would snap backwards to an earlier pass. Forward-only + a small backward
  tolerance (25 m) prevents that.
- Output per fix: `matched_arc_m` (distance along R1) and `cross_track_m`
  (perpendicular distance = how far off R1 they are).
- The search anchor advances **only when on-route**, so a detour can't drag the
  match position with it.

### 2.4 Adaptive search window — **handles tunnels**
The forward window grows with the **time gap** since the last fix
(`window = 200 m + Δt × 45 m/s`, capped 3000 m). Why: after a GPS dropout in a
tunnel the car legitimately resumes far ahead on R1, so the window must stretch to
find it — while staying tight for dense 1 Hz fixes so loops don't over-reach.

### 2.5 Deviation detection — **with hysteresis (anti-noise)**
- A fix is **off-route** when `cross_track_m > deviation_m` (30 m).
- But a short blip is just GPS noise, not a real deviation. So any off-route run
  that covers **less than `sustain_m` (50 m) of travel is reclassified as
  on-route**. A real deviation must be *sustained*. This stops a good drive being
  shredded by momentary jitter (urban canyons, tree cover).

### 2.6 Splicing — **drop off-route frames, keep continuous R1 spans**
Contiguous on-route runs become `journey_segments`. A genuine deviation (car left
R1 and came back) splits the drive into two kept segments with the off-route span
removed. Because a wrong turn almost always **rejoins R1 at the same point**, the
splice is **positionally seamless** — `reentrySeamless` is true when the re-entry
arc is within `reentry_tolerance_m` (35 m) of the exit arc.

### 2.7 Teleport split — **distinguishes a skip from a tunnel**
Within an on-route run we also split wherever the arc jumps **faster than
physically possible** (`arcJump > 45 m/s × Δt + 40 m`). This is the crucial
discriminator:
- **Tunnel** (GPS dropped, drove R1 continuously): resumes at a *plausible* speed →
  no split → bridged → counts as covered.
- **Skip** (stopped following, rejoined ahead): "teleports" at an impossible speed →
  split → leaves a **coverage gap**.

### 2.8 Coverage + verdict
- Merge the kept segments' arc-ranges; **covered length ÷ R1 length = coverage %**.
- Any uncovered internal stretch longer than `gap_m` (75 m) is a reported **gap**.
- **Verdict = rejected** if coverage `< min_coverage_pct` (98%) **or** any gap
  exists; otherwise **verified**. Rejections carry a specific reason
  (`"Only 39.7% of R1 was covered"` / `"Missing footage from X m to Y m"`).

### 2.9 The player timeline
On-route fixes are emitted as `{ t_ms, arc_m, lat, lng }` with lat/lng **snapped
onto R1** via `pointAtArc`. This is the `videoTime → position-on-R1` mapping the
player uses. Between 1 Hz samples the client interpolates along R1, so the marker
moves smoothly at 30 fps.

### 2.10 Confidence score
`sync_confidence` (0–100) is an explainable heuristic: start at 100, subtract for
low coverage, for each gap, and for extreme max-deviation. It gates auto-publish
vs human review.

---

## 3. Video processing — **DESIGNED (next layer, not yet built)**

> Honesty check: the GPS conformance + timeline above is live and tested. The
> video splice/transcode below is the **worker layer that consumes
> `journey_segments`** and is **not yet implemented**. It's specified here so you
> know exactly how it plugs in.

Pipeline (runs in `services/worker`, Python):
1. **Ingest & stitch** — dashcams split into 3-min files; concatenate in order,
   tracking cumulative offsets and inter-segment drops.
2. **Put video on the GPS clock** — see §4 (this is the one hard step, and it
   differs per recording scenario).
3. **Splice** — cut the video to the on-route windows in `journey_segments`,
   snapping each cut to a video keyframe for a clean encode. Off-route spans are
   removed (they carry no R1 information).
4. **Transcode** — front/rear → HLS, write `route_videos` (with `sync_offset_ms`),
   `route_previews`.
5. **Derive markers/instructions** — from R1's road-network match, placed at the
   correct `t_ms` via the timeline (`route_markers`, `route_instructions`).

The existing worker already does adjacent media work (transcode, face/plate blur,
GPX handling) for the legacy upload flow — the new step is the **journey-driven
splice** keyed off `journey_segments`.

---

## 4. Synchronisation in every scenario — the clock logic

Everything hinges on tying each **video frame** to a **GPS fix**. GPS is always
captured **in the app** (the journey starts in-app), so the job is to pull each
camera onto that GPS/app clock. Two alignment primitives do it:

- **Speed cross-correlation** (video ↔ GPS): derive speed from GPS, derive apparent
  motion from the video (optical flow); the time lag that best aligns them is the
  offset. Speed profiles (stops at lights, roundabout slowdowns) are distinctive,
  so the peak is sharp. Two windows (start + end) also correct clock **drift**.
- **Audio cross-correlation** (video ↔ video): front and rear mics hear the same
  cabin sound; the lag that maximises correlation is the front↔rear offset.

| Scenario | Video source(s) | How sync is achieved | Accuracy |
|---|---|---|---|
| **Phone** | phone films front + captures GPS | **one device, one clock** | **frame-exact (free)** |
| **Phone + dashcam rear** | phone front (+GPS), dashcam rear | front exact; rear ↔ front by **audio** | front exact, rear ~sub-frame |
| **Dashcam** | dashcam films video, phone GPS only | dashcam ↔ GPS by **speed correlation** | **~sub-second** |
| **Dual dashcam** | one device films front+rear, phone GPS | cameras hardware-synced to each other; pair ↔ GPS by speed correlation | ~sub-second |

**Why this is honest, not hand-wavy:** with the phone filming, sync is exact by
construction. With a dashcam, it's correlation-based and we **measure** the
correlation quality and fold it into `sync_confidence`; a weak match is flagged for
review rather than silently published.

---

## 5. Edge cases and how each is handled

| Situation | Handling | Where |
|---|---|---|
| GPS cold-start / poor accuracy | reads as off-route until lock; route "start" is the first good fix near A | §2.2/2.3 |
| Tunnel / signal loss | adaptive window bridges; plausible-speed resume = covered | §2.4/2.7 |
| Stopped at lights (jitter) | ~0 travel → absorbed as noise, not a deviation | §2.5 |
| Momentary GPS wobble | short off-route run (<50 m travel) reclassified on-route | §2.5 |
| Wrong turn, return to same point | off-route span spliced out, **seamless** re-entry | §2.6 |
| Skipped a section | teleport split → coverage gap → **rejected** | §2.7/2.8 |
| Loop / parallel / crossing roads | monotonic forward match, not nearest-anywhere | §2.3 |
| Dashcam file splits | stitched with cumulative offsets | §3.1 |
| Front/rear started apart or drift | audio correlation (offset + drift) | §4 |
| Whole drive off R1 | low coverage → rejected with reason | §2.8 |

---

## 6. Why you can be confident (the facts)

1. **The displayed route is exact** — we render R1 itself, the ground truth. GPS
   noise never reaches the learner's screen.
2. **The GPS engine is deterministic and tested** — same input → same verdict.
   Smoke-tested across clean / deviation-and-return / skip / tunnel; try it with
   `npm run seed:journeys` and inspect real `journeys` / `journey_segments` rows.
3. **Sync is exact when the phone films**, and ~sub-second (with a *measured*
   confidence) when a dashcam films — never a silent guess.
4. **Every decision is explainable and stored** — per-fix `cross_track_m` /
   `on_route`, the kept segments, the coverage %, the reject reason. Nothing is a
   black box; an admin sees the numbers, not a scrub-through.
5. **Thresholds are tunable without a redeploy** (`platform_config`), so real-world
   GPS behaviour can be dialled in once you have live recordings.
6. **Fail-safe by policy** — anything below coverage/confidence thresholds is
   rejected or sent to review, not published. A bad recording can't slip through.

---

## 7. Status summary (no ambiguity)

| Piece | Status |
|---|---|
| Reference route (R1) storage + API | ✅ built |
| GPS map-matching, deviation, splice, coverage, verdict, timeline | ✅ built (`matching.ts`) |
| Journey lifecycle API (create R1 / start / live-check / submit / get) | ✅ built |
| Live deviation warning **endpoint** (`/journeys/:id/check`) | ✅ built |
| Demo data seeder | ✅ built (`npm run seed:journeys`) |
| In-app recording screens (Flutter) | ⏳ next layer |
| Worker video splice + transcode (consumes `journey_segments`) | ⏳ next layer |
| Video↔GPS speed/audio correlation (dashcam sync) | ⏳ next layer |
| `WatchPage` map-follows-marker on R1 | ⏳ next layer |

The **brain** (does the GPS match R1, and where does each moment sit on R1) is
done and verifiable today. The **video muscle** (cutting and transcoding the
footage to that plan) is the clearly-scoped next layer.
