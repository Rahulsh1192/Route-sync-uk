-- ============================================================================
-- Phase 24 — Dashcam multi-clip upload, video↔GPS sync, and map-follows-marker
--
-- Two recording usecases feed the same playable artifact:
--
--  UC1 "GPS dashcam"  — the camera records front+rear video AND a GPS log, on the
--                       camera's own clock. The instructor copies N video clips +
--                       N GPS files off the device and uploads them together.
--  UC2 "dumb dashcam" — the camera records video only; the GPS track is recorded
--                       live in our app (Phase 23 `journeys`). The video is
--                       uploaded later and ATTACHED to that saved journey, so the
--                       two clocks must be aligned by correlation.
--
-- The load-bearing decision here: dashcams split a drive into short clips and drop
-- 0.5-2 s BETWEEN files. A naive concat makes video time shorter than wall-clock
-- time, so a map marker driven by video time drifts progressively further behind
-- (seconds by the end of a 20-minute drive — exactly where a learner notices).
-- We therefore never rely on "concatenated video time == elapsed real time".
-- `route_clip_timeline` records, per clip, the exact mapping between position in
-- the concatenated video and absolute wall-clock time, including the gap that
-- preceded it. The player and every derived artifact map through this table.
--
-- The master clock is ABSOLUTE UTC epoch milliseconds. Relative `t_ms` (used by
-- the clients) is derived from it at the end of the pipeline, once, so that
-- cross-source alignment maths never happens in two different reference frames.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Uploads gain the recording provenance the pipeline needs to pick a strategy
-- ----------------------------------------------------------------------------
ALTER TABLE uploads
  -- 'camera'      = GPS log files came off the dashcam (UC1)
  -- 'embedded'    = GPS is embedded in the video container/data stream (UC1, best case)
  -- 'app_journey' = GPS was recorded in our app; align by correlation (UC2)
  ADD COLUMN IF NOT EXISTS gps_source            TEXT NOT NULL DEFAULT 'camera',
  -- UC2: the Phase 23 journey whose GPS track this video belongs to.
  ADD COLUMN IF NOT EXISTS journey_id            UUID REFERENCES journeys(id) ON DELETE SET NULL,
  -- The R1 this recording claims to replicate. Phase 24 decision: dashcam uploads
  -- ARE conformance-checked, so the uploaded GPS is not automatically published.
  ADD COLUMN IF NOT EXISTS reference_route_id    UUID REFERENCES reference_routes(id) ON DELETE SET NULL,
  -- Instructor-supplied correction for a dashcam whose clock is wrong (unset after
  -- battery loss, wrong timezone, no DST). Applied to every clip's start time.
  ADD COLUMN IF NOT EXISTS camera_clock_offset_ms BIGINT NOT NULL DEFAULT 0,
  -- Final front↔GPS offset the pipeline settled on, and how sure it is (0..100).
  ADD COLUMN IF NOT EXISTS resolved_offset_ms    BIGINT,
  ADD COLUMN IF NOT EXISTS sync_confidence       INTEGER,
  -- Set when a low-confidence alignment needs the instructor to confirm it by eye
  -- before the route may be published (the scrub-to-match step).
  ADD COLUMN IF NOT EXISTS sync_confirmed_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_uploads_journey   ON uploads (journey_id);
CREATE INDEX IF NOT EXISTS idx_uploads_reference ON uploads (reference_route_id);

-- ----------------------------------------------------------------------------
-- 2. Per-file provenance: where each clip's start time actually came from
-- ----------------------------------------------------------------------------
-- `started_at`, `duration_s`, `ordinal` already exist (Phase 2). What was missing
-- is WHY we believe a clip starts when we say it does — a filename-derived
-- timestamp is trustworthy, an mtime is nearly worthless (copying files rewrites
-- it on some systems), and a user override beats both. Surfacing this lets the
-- review screen explain itself and lets the quality score punish weak evidence.
ALTER TABLE upload_files
  -- 'filename' | 'container' | 'gps' | 'mtime' | 'user'
  ADD COLUMN IF NOT EXISTS start_source     TEXT,
  -- which registry entry matched the filename, e.g. 'viofo', 'nextbase', 'generic_dtm'
  ADD COLUMN IF NOT EXISTS detected_brand   TEXT,
  -- instructor's drag-to-reorder override from the review screen; wins over detection
  ADD COLUMN IF NOT EXISTS declared_ordinal INTEGER,
  -- GPS files only: how many usable fixes were parsed out of this file
  ADD COLUMN IF NOT EXISTS gps_point_count  INTEGER,
  -- GPS files only: the format the parser actually used ('gpx','nmea','csv','embedded')
  ADD COLUMN IF NOT EXISTS gps_format       TEXT,
  -- absolute span of this file on the master clock, after clock correction
  ADD COLUMN IF NOT EXISTS start_epoch_ms   BIGINT,
  ADD COLUMN IF NOT EXISTS end_epoch_ms     BIGINT;

-- ----------------------------------------------------------------------------
-- 3. The clip → timeline map (the anti-drift table)
-- ----------------------------------------------------------------------------
-- One row per source clip per camera view. `video_start_ms`/`video_end_ms` are
-- positions in the CONCATENATED output; `wall_start_epoch_ms` is when that clip
-- actually began recording. `gap_before_ms` is the dead air between the previous
-- clip's end and this clip's start — real elapsed time that exists on the wall
-- clock but has no frames. Players convert video time → wall clock by finding the
-- containing row and adding the within-clip delta, which stays exact regardless of
-- how many gaps there were.
CREATE TABLE IF NOT EXISTS route_clip_timeline (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id            UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  view                camera_view NOT NULL,
  clip_seq            INTEGER NOT NULL,               -- 0-based order within the view
  source_file_id      UUID REFERENCES upload_files(id) ON DELETE SET NULL,
  original_name       TEXT,
  video_start_ms      BIGINT NOT NULL,                -- offset in the concatenated video
  video_end_ms        BIGINT NOT NULL,
  wall_start_epoch_ms BIGINT NOT NULL,                -- master clock
  wall_end_epoch_ms   BIGINT NOT NULL,
  gap_before_ms       BIGINT NOT NULL DEFAULT 0,      -- dropped time before this clip
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, view, clip_seq)
);
CREATE INDEX IF NOT EXISTS idx_clip_timeline_route ON route_clip_timeline (route_id, view, clip_seq);

-- ----------------------------------------------------------------------------
-- 4. Track points: make the existing table usable as the marker's data source
-- ----------------------------------------------------------------------------
-- `route_track_points` has existed since Phase 2 but nothing has ever written to
-- it, which is precisely why both players show a static map. Two changes make it
-- fit for purpose:
--   * t_ms to BIGINT — INTEGER overflows at ~24 days but, more practically, keeps
--     every timeline column the same width so joins/casts don't surprise anyone.
--   * bearing_deg — so the marker can point the way the car was facing. Deriving
--     it in the client from consecutive points is noisy at low speed; the worker
--     computes it once over a smoothed window.
ALTER TABLE route_track_points
  ADD COLUMN IF NOT EXISTS bearing_deg     REAL,
  ADD COLUMN IF NOT EXISTS accuracy_m      REAL,
  -- true when this point is inside a kept (on-R1) span; off-route points are
  -- retained for admin forensics but not sent to learners.
  ADD COLUMN IF NOT EXISTS on_route        BOOLEAN NOT NULL DEFAULT TRUE,
  -- arc-length along R1, so the map can be driven from R1 rather than raw GPS
  ADD COLUMN IF NOT EXISTS arc_m           DOUBLE PRECISION;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_track_points' AND column_name = 't_ms'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE route_track_points ALTER COLUMN t_ms TYPE BIGINT;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Journeys ↔ uploads (UC2's missing join) + an absolute clock anchor
-- ----------------------------------------------------------------------------
-- `journey_gps_points.t_ms` is relative to journey start, which is fine in-app but
-- useless for aligning against a camera clock. Storing the absolute start lets the
-- worker put app-recorded GPS onto the same epoch timeline as the video.
ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS upload_id          UUID REFERENCES uploads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at_epoch_ms BIGINT,
  -- how the video that belongs to this journey was supplied, once it arrives
  ADD COLUMN IF NOT EXISTS video_upload_state TEXT;   -- awaiting_video | processing | attached

CREATE INDEX IF NOT EXISTS idx_journeys_upload ON journeys (upload_id);

-- Backfill the anchor for journeys recorded before this migration.
UPDATE journeys
   SET started_at_epoch_ms = (EXTRACT(EPOCH FROM started_at) * 1000)::BIGINT
 WHERE started_at_epoch_ms IS NULL;

-- ----------------------------------------------------------------------------
-- 6. New pipeline stages
-- ----------------------------------------------------------------------------
-- `upload_stages.stage` is an enum, so the new stages have to be declared before the
-- worker can report progress for them. `IF NOT EXISTS` makes a re-run a no-op.
-- Note: these run inside this migration's transaction, which PostgreSQL 12+ allows
-- precisely because nothing here WRITES a row using the new values — that only
-- becomes legal after commit, which is when the worker starts using them.
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'gps_merge'    AFTER 'gap_detect';
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'reconcile'    AFTER 'gps_merge';
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'audio_sync'   AFTER 'front_rear_reconcile';
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'conformance'  AFTER 'sync_engine';
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'track_points' AFTER 'conformance';

-- ----------------------------------------------------------------------------
-- 7. Tunables + the DYNAMIC dashcam format registry
-- ----------------------------------------------------------------------------
-- Decision: new dashcam models must be supportable WITHOUT a code change. The
-- registry lives in platform_config as JSON, so an admin can add a brand's
-- filename convention or GPS log format at runtime. The worker ships the same
-- list as a built-in default and merges anything found here on top of it, so a
-- malformed edit degrades to the defaults rather than breaking ingest.
--
-- Entry shape:
--   {
--     "brand": "viofo",
--     "pattern": "^(?P<Y>\\d{4})_(?P<m>\\d{2})(?P<d>\\d{2})_(?P<H>\\d{2})(?P<M>\\d{2})(?P<S>\\d{2})_(?P<seq>\\d+)?(?P<view>[FR])?",
--     "view_map": { "F": "front", "R": "rear" },
--     "tz": "camera_local"
--   }
-- `pattern` uses named groups Y m d H M S (and optional view/seq). Any brand whose
-- filename encodes a timestamp is expressible without new code.
INSERT INTO platform_config (key, value) VALUES
  -- reconciliation: how closely the video span must sit inside the GPS span
  ('sync_min_overlap_pct',        '95'),
  -- a clip gap longer than this is a hole in the recording, not camera latency
  ('sync_max_clip_gap_s',         '10'),
  -- front↔rear duration disagreement that gets flagged for review
  ('sync_max_front_rear_drift_s', '2'),
  -- below this confidence the instructor must confirm alignment before publish
  ('sync_min_confidence',         '70'),
  -- output cadence of route_track_points (GPS is typically 1 Hz)
  ('track_point_hz',              '1'),
  -- admin-extensible registry; empty array = use the worker's built-in defaults
  ('dashcam_format_registry',     '[]')
  ON CONFLICT (key) DO NOTHING;

COMMIT;
