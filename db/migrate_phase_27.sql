-- ============================================================================
-- Phase 27 — de-duplicate test centres, and give instructors a location
--
-- Two problems found in testing:
--
--  1. **Duplicate test centres.** `test_centres` had no unique constraint on the name, so
--     the `ON CONFLICT DO NOTHING` in db/seed.sql matched nothing at all — the only
--     unique column was the primary key, which is `gen_random_uuid()` and therefore never
--     collides. Every re-run of the seed inserted a complete second copy of every centre,
--     and `TestCentresService.create()` had no duplicate check either. This deletes the
--     copies, repoints everything that referenced them, and adds the constraint that
--     should have been there — after which the seed's ON CONFLICT actually works.
--
--  2. **Instructors had no location.** `instructor_profiles` carried an optional
--     `service_area_geom` polygon that nothing populated, and no base point at all, so
--     "find instructors near this postcode" had nothing to measure a distance from and
--     the postcode argument was silently ignored.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Merge duplicate test centres
-- ----------------------------------------------------------------------------
-- Centres are matched on their name, normalised for case and whitespace only. Deliberately
-- not on the postcode too: the duplicate rows this cleans up came from the same seed and
-- so agree on the postcode, whereas a hand-typed centre may carry a differently formatted
-- one — matching on both would let "Mill Hill / NW7 1RB" and "Mill Hill / nw71rb" survive
-- as two centres, which is the exact problem being fixed.
--
-- DVSA centre names already disambiguate by locality ("Birmingham (South Yardley)",
-- "Birmingham (Kings Heath)"), so the name alone is a sound key for real centres.

CREATE OR REPLACE FUNCTION tc_norm_name(txt TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE STRICT AS
$$ SELECT regexp_replace(btrim(lower(txt)), '\s+', ' ', 'g') $$;

COMMENT ON FUNCTION tc_norm_name(TEXT) IS
  'Normalises a test-centre name for duplicate detection (case + whitespace). IMMUTABLE so '
  'it can back the unique index on test_centres.';

DO $$
DECLARE
  fk      RECORD;
  merged  INTEGER := 0;
  removed INTEGER;
BEGIN
  -- Nothing to do on a clean database; the constraint at the end is then just a guard.
  IF NOT EXISTS (
    SELECT 1 FROM test_centres GROUP BY tc_norm_name(name) HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'test_centres: no duplicates found';
  ELSE
    -- The survivor of each group is the oldest row, because that is the one existing
    -- references and bookmarked URLs are most likely to point at. `id` breaks ties so the
    -- choice is deterministic across re-runs.
    CREATE TEMP TABLE tc_dupe_map AS
    SELECT t.id AS dupe_id, k.keeper_id
    FROM test_centres t
    JOIN (
      SELECT tc_norm_name(name) AS norm,
             (array_agg(id ORDER BY created_at, id))[1] AS keeper_id
      FROM test_centres
      GROUP BY tc_norm_name(name)
    ) k ON k.norm = tc_norm_name(t.name)
    WHERE t.id <> k.keeper_id;

    SELECT COUNT(*) INTO merged FROM tc_dupe_map;

    -- Detail typed against a duplicate would otherwise be lost with it. The keeper only
    -- takes a value where it has none of its own, so an edited keeper is never overwritten
    -- by a stale copy.
    UPDATE test_centres k SET
      address     = COALESCE(k.address,     d.address),
      description = COALESCE(k.description, d.description),
      town        = COALESCE(k.town,        d.town),
      region      = COALESCE(k.region,      d.region)
    FROM (
      SELECT m.keeper_id,
             (array_agg(t.address     ORDER BY t.created_at) FILTER (WHERE t.address     IS NOT NULL))[1] AS address,
             (array_agg(t.description ORDER BY t.created_at) FILTER (WHERE t.description IS NOT NULL))[1] AS description,
             (array_agg(t.town        ORDER BY t.created_at) FILTER (WHERE t.town        IS NOT NULL))[1] AS town,
             (array_agg(t.region      ORDER BY t.created_at) FILTER (WHERE t.region      IS NOT NULL))[1] AS region
      FROM tc_dupe_map m
      JOIN test_centres t ON t.id = m.dupe_id
      GROUP BY m.keeper_id
    ) d
    WHERE k.id = d.keeper_id;

    -- Every column that references test_centres(id) is repointed, discovered from the
    -- catalogue rather than hard-coded: eleven tables reference this one across the
    -- migration history, and a list written out by hand here would silently rot the next
    -- time one is added, leaving rows pointing at a centre that is about to be deleted.
    FOR fk IN
      SELECT c.conrelid::regclass::text AS tbl,
             a.attname                  AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = 'test_centres'::regclass
        AND array_length(c.conkey, 1) = 1
    LOOP
      EXECUTE format(
        'UPDATE %s t SET %I = m.keeper_id FROM tc_dupe_map m WHERE t.%I = m.dupe_id',
        fk.tbl, fk.col, fk.col
      );
      RAISE NOTICE 'test_centres dedupe: repointed %.%', fk.tbl, fk.col;
    END LOOP;

    DELETE FROM test_centres WHERE id IN (SELECT dupe_id FROM tc_dupe_map);
    GET DIAGNOSTICS removed = ROW_COUNT;
    RAISE NOTICE 'test_centres dedupe: merged % duplicate row(s), deleted %', merged, removed;

    DROP TABLE tc_dupe_map;
  END IF;
END $$;

-- The constraint that makes db/seed.sql's ON CONFLICT clauses meaningful, and that stops
-- `create()` from adding a centre that already exists under a differently cased name.
CREATE UNIQUE INDEX IF NOT EXISTS idx_test_centres_name_unique
  ON test_centres (tc_norm_name(name));

-- ----------------------------------------------------------------------------
-- 2. Where an instructor is based
-- ----------------------------------------------------------------------------
-- `base_postcode` is what the instructor types and what we show back to them;
-- `base_location` is what it geocoded to, and is what proximity search actually uses.
-- Both nullable: existing instructors have neither, and a search has to keep working for
-- them (they rank after everyone locatable rather than disappearing).
ALTER TABLE instructor_profiles
  ADD COLUMN IF NOT EXISTS base_postcode    TEXT,
  ADD COLUMN IF NOT EXISTS base_location    GEOGRAPHY(Point,4326),
  -- How far they will travel to a lesson. Distinct from the existing `service_area_km`,
  -- which pairs with the unpopulated `service_area_geom` polygon; this one is a plain
  -- radius around `base_location` and is the value the search uses.
  ADD COLUMN IF NOT EXISTS travel_radius_km NUMERIC(5,1) NOT NULL DEFAULT 16.0;

COMMENT ON COLUMN instructor_profiles.base_location IS
  'Geocoded from base_postcode via postcodes.io. NULL for instructors who have not set one.';
COMMENT ON COLUMN instructor_profiles.travel_radius_km IS
  'Radius around base_location the instructor will travel for a lesson. Default 16km (~10 miles).';

-- Proximity search orders by distance from the learner''s postcode, so the index is on the
-- point. Partial: a profile with no base_location can never match a radius query.
CREATE INDEX IF NOT EXISTS idx_instructor_profiles_base_geo
  ON instructor_profiles USING GIST (base_location)
  WHERE base_location IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. An uploaded badge photo, rather than a URL the applicant has to find
-- ----------------------------------------------------------------------------
-- `evidence_url` already existed, but it only ever held a link the applicant typed — which
-- assumes they have somewhere to host a photo of their DVSA certificate. In testing there
-- was no way to attach a badge photo at all. `evidence_key` is an object key in our own
-- private bucket, uploaded directly by the applicant.
--
-- Kept as a separate column rather than overloading `evidence_url`: one holds a third-party
-- link we can only pass through, the other an object we must presign to display, and a
-- single column would leave no way to tell which it is.
ALTER TABLE instructor_verifications
  ADD COLUMN IF NOT EXISTS evidence_key TEXT;

COMMENT ON COLUMN instructor_verifications.evidence_key IS
  'Private object key for an uploaded badge photo/certificate. Never public — moderators '
  'view it through a short-lived presigned GET.';

COMMIT;
