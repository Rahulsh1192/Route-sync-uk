-- ============================================================================
-- Phase 23 — Reference routes (R1) + recorded journeys + GPS↔R1 conformance
--
-- The examiner's canonical route R1 is stored once (a PostGIS LineString). An
-- instructor records a drive (video on phone OR dashcam; GPS always captured in
-- the app) and submits the GPS track. The matching engine map-matches every fix
-- onto R1, flags deviations (cross-track > threshold, sustained), splices out the
-- off-route spans, and computes R1 coverage. Off-route frames carry no R1
-- information and are dropped; a coverage gap is surfaced to the admin, who
-- rejects the video. We publish R1's geometry; the recorded drive is bound to it.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

BEGIN;

-- The canonical route the instructor must replicate (from the real examiner GPX).
CREATE TABLE IF NOT EXISTS reference_routes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_centre_id UUID REFERENCES test_centres(id),
  name           TEXT NOT NULL,
  start_label    TEXT,                              -- point A
  end_label      TEXT,                              -- point B
  source_gpx_key TEXT,                              -- optional stored GPX object
  geom           GEOGRAPHY(LineString, 4326) NOT NULL,
  length_m       DOUBLE PRECISION NOT NULL DEFAULT 0,
  point_count    INTEGER NOT NULL DEFAULT 0,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reference_routes_centre ON reference_routes (test_centre_id);
CREATE INDEX IF NOT EXISTS idx_reference_routes_geo    ON reference_routes USING GIST (geom);

-- One recording attempt against a reference route.
CREATE TABLE IF NOT EXISTS journeys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_route_id  UUID NOT NULL REFERENCES reference_routes(id) ON DELETE CASCADE,
  instructor_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id            UUID REFERENCES routes(id) ON DELETE SET NULL, -- published route, once approved
  video_source        TEXT NOT NULL DEFAULT 'phone',   -- 'phone' | 'dashcam' | 'dual'
  status              TEXT NOT NULL DEFAULT 'recording', -- recording | submitted | verified | rejected
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at        TIMESTAMPTZ,
  coverage_pct        NUMERIC(6,3),
  max_deviation_m     NUMERIC(8,2),
  deviation_count     INTEGER,
  sync_confidence     INTEGER,                         -- 0..100
  verdict             TEXT,                            -- verified | rejected
  reject_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journeys_instructor ON journeys (instructor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_journeys_reference  ON journeys (reference_route_id);

-- The recorded GPS track + per-fix match results (append-only truth).
CREATE TABLE IF NOT EXISTS journey_gps_points (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id     UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  t_ms           BIGINT NOT NULL,                   -- ms from journey start (app clock)
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  accuracy_m     REAL,
  speed_mps      REAL,
  matched_arc_m  DOUBLE PRECISION,                  -- arc-length along R1
  cross_track_m  REAL,                              -- perpendicular distance to R1
  on_route       BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_journey_gps_seq ON journey_gps_points (journey_id, seq);

-- The kept, on-route spans after splicing (feed the player timeline). Each span
-- maps a video-time window to an R1 arc-length range.
CREATE TABLE IF NOT EXISTS journey_segments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id   UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  start_t_ms   BIGINT NOT NULL,
  end_t_ms     BIGINT NOT NULL,
  start_arc_m  DOUBLE PRECISION NOT NULL,
  end_arc_m    DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journey_segments ON journey_segments (journey_id, seq);

-- Tunable conformance thresholds (no redeploy).
INSERT INTO platform_config (key, value) VALUES
  ('journey_deviation_m', '30'),          -- cross-track distance that counts as off-route
  ('journey_deviation_sustain_m', '50'),  -- off-route travel before it's a real deviation
  ('journey_min_coverage_pct', '98'),     -- R1 coverage required to auto-pass
  ('journey_gap_m', '75'),                -- an uncovered R1 stretch this long = a gap
  ('journey_reentry_tolerance_m', '35')   -- re-entry arc must match exit arc within this
  ON CONFLICT (key) DO NOTHING;

COMMIT;
