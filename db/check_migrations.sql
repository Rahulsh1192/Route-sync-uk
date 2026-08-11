-- ============================================================================
-- Which migrations has this database actually had applied?
--
-- Read-only. Paste into any SQL console (Render, Supabase, psql) pointed at the
-- database the API uses, and every row should read PRESENT. A MISSING row names the
-- migration file to run.
--
-- Exists because the migrations are applied by hand: there is no migration table
-- recording what ran, so the only reliable answer comes from checking the schema itself.
-- ============================================================================

WITH expected(phase, migration, kind, obj, detail) AS (
  VALUES
    -- Phase 24 — video/GPS sync
    ('24', 'db/migrate_phase_24.sql', 'table',  'route_clip_timeline',      NULL),
    ('24', 'db/migrate_phase_24.sql', 'column', 'uploads',                  'gps_source'),
    ('24', 'db/migrate_phase_24.sql', 'column', 'uploads',                  'reference_route_id'),
    ('24', 'db/migrate_phase_24.sql', 'column', 'upload_files',             'start_source'),
    ('24', 'db/migrate_phase_24.sql', 'column', 'route_track_points',       'bearing_deg'),
    ('24', 'db/migrate_phase_24.sql', 'column', 'journeys',                 'upload_id'),
    -- Phase 25 — Cloudflare R2 storage
    ('25', 'db/migrate_phase_25.sql', 'column', 'upload_files',             'sha256'),
    ('25', 'db/migrate_phase_25.sql', 'column', 'upload_files',             'multipart_upload_id'),
    ('25', 'db/migrate_phase_25.sql', 'column', 'route_videos',             'variants'),
    ('25', 'db/migrate_phase_25.sql', 'column', 'route_videos',             'sha256'),
    ('25', 'db/migrate_phase_25.sql', 'column', 'route_previews',           'thumbnail_small_key'),
    ('25', 'db/migrate_phase_25.sql', 'column', 'uploads',                  'cleanup_state'),
    ('25', 'db/migrate_phase_25.sql', 'config', 'hls_ladder',               NULL),
    ('25', 'db/migrate_phase_25.sql', 'config', 'upload_part_size_mb',      NULL),
    -- Phase 26 — contact details + ADI expiry
    ('26', 'db/migrate_phase_26.sql', 'column', 'users',                    'phone'),
    ('26', 'db/migrate_phase_26.sql', 'column', 'users',                    'emergency_contact_phone'),
    ('26', 'db/migrate_phase_26.sql', 'column', 'instructor_verifications', 'adi_expiry'),
    ('26', 'db/migrate_phase_26.sql', 'column', 'contributors',             'adi_expiry'),
    -- Phase 27 — test-centre de-duplication, instructor locations, badge photos
    ('27', 'db/migrate_phase_27.sql', 'index',  'idx_test_centres_name_unique',  NULL),
    ('27', 'db/migrate_phase_27.sql', 'column', 'instructor_profiles',      'base_location'),
    ('27', 'db/migrate_phase_27.sql', 'column', 'instructor_profiles',      'base_postcode'),
    ('27', 'db/migrate_phase_27.sql', 'column', 'instructor_profiles',      'travel_radius_km'),
    ('27', 'db/migrate_phase_27.sql', 'column', 'instructor_verifications', 'evidence_key')
)
SELECT
  e.phase,
  e.kind || ' ' || e.obj || COALESCE('.' || e.detail, '') AS checked,
  CASE WHEN found THEN 'PRESENT' ELSE 'MISSING  -> run ' || e.migration END AS status
FROM expected e
CROSS JOIN LATERAL (
  SELECT CASE e.kind
    WHEN 'table' THEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = e.obj)
    WHEN 'column' THEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = e.obj AND column_name = e.detail)
    -- platform_config is a key/value table, so these are rows rather than schema.
    WHEN 'config' THEN EXISTS (
      SELECT 1 FROM platform_config WHERE key = e.obj)
    -- Phase 27's headline fix is a unique index, not a table or column: without it the
    -- seeds' ON CONFLICT clauses match nothing and re-running one duplicates every centre.
    WHEN 'index' THEN EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = e.obj)
  END AS found
) f
ORDER BY e.phase, checked;
