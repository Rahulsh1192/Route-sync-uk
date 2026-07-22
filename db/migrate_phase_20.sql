-- ============================================================================
-- Phase 20 — Test Centres module (Test Routify)
-- Adds editable address + description to test centres so admins/instructors can
-- manage them as first-class records. Lat/lng continue to live in `location`
-- (PostGIS geography), auto-derived from the postcode via postcodes.io.
-- Idempotent: safe to run on an already-migrated database.
-- ============================================================================

ALTER TABLE test_centres ADD COLUMN IF NOT EXISTS address     TEXT;
ALTER TABLE test_centres ADD COLUMN IF NOT EXISTS description TEXT;

-- Route → test centre is now a required relationship at the application layer
-- (enforced in the upload/create flow). We intentionally do NOT set the column
-- NOT NULL here so pre-existing seed rows without a centre keep loading; new
-- routes must supply one. An index keeps "routes for a centre" fast.
CREATE INDEX IF NOT EXISTS idx_routes_test_centre ON routes (test_centre_id);
