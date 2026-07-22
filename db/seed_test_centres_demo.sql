-- ============================================================================
-- Demo data for the Test Centres module (Phase 20).
-- 1) Backfills address + description on a few already-seeded centres that have
--    routes attached, so their detail page shows the new fields with real routes.
-- 2) Inserts a few fully-populated dummy centres so the list looks rich.
-- Idempotent-ish: the INSERTs skip rows whose name already exists.
-- ============================================================================

-- 1) Enrich existing seeded centres (these already have published routes) -------
UPDATE test_centres SET
  address = '5 Bunns Lane, Mill Hill, London',
  description = 'A busy suburban test centre with a mix of dual carriageways, roundabouts and residential estates. Popular first-test choice in north London.'
WHERE name = 'Mill Hill';

UPDATE test_centres SET
  address = 'Nestles Avenue, Hayes',
  description = 'West London centre known for its multi-lane roundabouts and the A312 dual carriageway.'
WHERE name = 'Hayes (Yeading)';

UPDATE test_centres SET
  address = 'Worton Road, Isleworth',
  description = 'Covers the Great West Road and several complex box junctions near Brentford.'
WHERE name = 'Isleworth';

-- 2) Brand-new dummy centres (skipped if the name already exists) ---------------
INSERT INTO test_centres (name, town, postcode, region, address, description, location)
SELECT * FROM (VALUES
  ('Demo Test Centre — Central', 'Birmingham', 'B4 7SL', 'West Midlands',
   '1 Learner Way, Birmingham',
   'A demo centre for trying out the app: city-centre traffic, tram crossings and one-way systems.',
   ST_SetSRID(ST_MakePoint(-1.8904, 52.4862), 4326)::geography),
  ('Demo Test Centre — Coastal', 'Brighton', 'BN2 5TR', 'South East',
   '22 Seafront Road, Brighton',
   'Demo centre with seafront roads, steep hills and a challenging gyratory.',
   ST_SetSRID(ST_MakePoint(-0.1372, 50.8225), 4326)::geography),
  ('Demo Test Centre — Rural', 'Harrogate', 'HG1 4ST', 'Yorkshire',
   '7 Meadow Lane, Harrogate',
   'Demo centre featuring national-speed-limit country lanes and unmarked junctions.',
   ST_SetSRID(ST_MakePoint(-1.5373, 53.9925), 4326)::geography)
) AS v(name, town, postcode, region, address, description, location)
WHERE NOT EXISTS (SELECT 1 FROM test_centres t WHERE t.name = v.name);

-- 3) Map a few existing (previously unpublished) routes onto the demo centres so
--    each one shows at least one route. Safe to re-run.
UPDATE routes SET status='published', published_at=COALESCE(published_at, now()),
  test_centre_id = (SELECT id FROM test_centres WHERE name LIKE 'Demo Test Centre%Central')
WHERE id='77777777-7777-7777-7777-777777777777';

UPDATE routes SET status='published', published_at=COALESCE(published_at, now()),
  test_centre_id = (SELECT id FROM test_centres WHERE name LIKE 'Demo Test Centre%Coastal')
WHERE id='88888888-8888-8888-8888-888888888888';

UPDATE routes SET status='published', published_at=COALESCE(published_at, now()),
  test_centre_id = (SELECT id FROM test_centres WHERE name LIKE 'Demo Test Centre%Rural')
WHERE id='99999999-9999-9999-9999-999999999999';
