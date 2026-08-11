-- =============================================================================
-- RouteSync — development seed data
-- =============================================================================
-- Idempotent: safe to run repeatedly. Creates:
--   * UK driving-test centres (reference data)
--   * a demo contributor account you can log in with
--       email:    demo@routesync.uk
--       password: Password123!
--   * an active premium subscription for that account
--   * one fully-formed, published sample route (videos + GPX + instructions +
--     markers + preview + quality) so Discover / Watch / Practice all work.
--
-- Run:
--   docker compose -f infra/docker-compose.yml exec -T postgres \
--     psql -U routesync -d routesync < db/seed.sql
-- =============================================================================

BEGIN;

-- fixed IDs so the seed is idempotent and cross-referenceable
-- user   11111111-… | route 22222222-… | test centre 33333333-…

-- --- test centres (approx coordinates) — Phase 5 UK DVSA seed data -----------
-- London
INSERT INTO test_centres (id, name, town, postcode, region, location) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Mill Hill',         'Mill Hill',       'NW7 1RB', 'London', ST_GeogFromText('SRID=4326;POINT(-0.2470 51.6023)')),
  (gen_random_uuid(), 'Isleworth',                              'Isleworth',        'TW7 4AG', 'London', ST_GeogFromText('SRID=4326;POINT(-0.3390 51.4746)')),
  (gen_random_uuid(), 'Hayes (Yeading)',                        'Hayes',            'UB4 0LT', 'London', ST_GeogFromText('SRID=4326;POINT(-0.4030 51.5230)')),
  (gen_random_uuid(), 'Wood Green',                             'Wood Green',       'N22 6SA', 'London', ST_GeogFromText('SRID=4326;POINT(-0.1100 51.5970)')),
  (gen_random_uuid(), 'Wanstead',                               'Wanstead',         'E11 2JT', 'London', ST_GeogFromText('SRID=4326;POINT(0.0290 51.5780)')),
  (gen_random_uuid(), 'Barking',                                'Barking',          'IG11 8AX', 'London', ST_GeogFromText('SRID=4326;POINT(0.0805 51.5362)')),
  (gen_random_uuid(), 'Belvedere',                              'Belvedere',        'DA17 5QZ', 'London', ST_GeogFromText('SRID=4326;POINT(0.1550 51.4940)')),
  (gen_random_uuid(), 'Chessington',                            'Chessington',      'KT9 2NY', 'London', ST_GeogFromText('SRID=4326;POINT(-0.3000 51.3600)')),
  (gen_random_uuid(), 'Croydon',                                'Croydon',          'CR0 2RS', 'London', ST_GeogFromText('SRID=4326;POINT(-0.1000 51.3700)')),
  (gen_random_uuid(), 'Enfield',                                'Enfield',          'EN3 5JH', 'London', ST_GeogFromText('SRID=4326;POINT(-0.0350 51.6500)')),
  (gen_random_uuid(), 'Hornchurch',                             'Hornchurch',       'RM11 1NA', 'London', ST_GeogFromText('SRID=4326;POINT(0.2110 51.5590)')),
  (gen_random_uuid(), 'Norbury',                                'Norbury',          'SW16 4SH', 'London', ST_GeogFromText('SRID=4326;POINT(-0.1200 51.4100)')),
  (gen_random_uuid(), 'Tolworth',                               'Tolworth',         'KT6 7EL', 'London', ST_GeogFromText('SRID=4326;POINT(-0.2800 51.3800)')),
  (gen_random_uuid(), 'Twickenham',                             'Twickenham',       'TW2 6LZ', 'London', ST_GeogFromText('SRID=4326;POINT(-0.3390 51.4500)'))
-- Untargeted, so it also catches the unique name constraint added in Phase 27 rather than
-- only the primary key. Just Mill Hill has a fixed id here; every other row gets a fresh
-- uuid, so a PK-only clause skipped nothing and a re-run aborted on the duplicate name.
ON CONFLICT DO NOTHING;

-- South East England
INSERT INTO test_centres (name, town, postcode, region, location) VALUES
  ('Brighton (Hove)',     'Hove',          'BN3 6PF', 'South East', ST_GeogFromText('SRID=4326;POINT(-0.1660 50.8340)')),
  ('Canterbury',          'Canterbury',    'CT1 3AU', 'South East', ST_GeogFromText('SRID=4326;POINT(1.0800 51.2800)')),
  ('Guildford',           'Guildford',     'GU1 1BX', 'South East', ST_GeogFromText('SRID=4326;POINT(-0.5720 51.2360)')),
  ('Maidstone',           'Maidstone',     'ME15 6YE', 'South East', ST_GeogFromText('SRID=4326;POINT(0.5230 51.2700)')),
  ('Oxford',              'Oxford',        'OX4 2JY', 'South East', ST_GeogFromText('SRID=4326;POINT(-1.2580 51.7480)')),
  ('Portsmouth (Cosham)', 'Portsmouth',    'PO6 3RL', 'South East', ST_GeogFromText('SRID=4326;POINT(-1.0680 50.8520)')),
  ('Reading',             'Reading',       'RG1 8EP', 'South East', ST_GeogFromText('SRID=4326;POINT(-0.9780 51.4500)')),
  ('Southampton (Shirley)','Southampton',  'SO15 3AF', 'South East', ST_GeogFromText('SRID=4326;POINT(-1.4300 50.9200)')),
  ('Slough',              'Slough',        'SL1 4RB', 'South East', ST_GeogFromText('SRID=4326;POINT(-0.5960 51.5100)'))
ON CONFLICT DO NOTHING;

-- Midlands
INSERT INTO test_centres (name, town, postcode, region, location) VALUES
  ('Birmingham (Great Barr)',  'Birmingham',  'B43 7EZ', 'West Midlands', ST_GeogFromText('SRID=4326;POINT(-1.9250 52.5450)')),
  ('Birmingham (Kings Heath)', 'Birmingham',  'B14 7NT', 'West Midlands', ST_GeogFromText('SRID=4326;POINT(-1.8750 52.4250)')),
  ('Coventry',                 'Coventry',    'CV5 6BW', 'West Midlands', ST_GeogFromText('SRID=4326;POINT(-1.5450 52.4050)')),
  ('Derby',                    'Derby',       'DE23 8AJ', 'East Midlands', ST_GeogFromText('SRID=4326;POINT(-1.4780 52.9050)')),
  ('Leicester',                'Leicester',   'LE5 5DP',  'East Midlands', ST_GeogFromText('SRID=4326;POINT(-1.1000 52.6280)')),
  ('Nottingham (Chalfont)',     'Nottingham',  'NG8 6PW',  'East Midlands', ST_GeogFromText('SRID=4326;POINT(-1.2100 52.9400)')),
  ('Wolverhampton',            'Wolverhampton','WV10 0NH','West Midlands', ST_GeogFromText('SRID=4326;POINT(-2.1280 52.5950)'))
ON CONFLICT DO NOTHING;

-- North of England
INSERT INTO test_centres (name, town, postcode, region, location) VALUES
  ('Leeds (Moortown)',       'Leeds',       'LS17 6NL', 'Yorkshire', ST_GeogFromText('SRID=4326;POINT(-1.5400 53.8480)')),
  ('Manchester (Didsbury)',  'Manchester',  'M20 2HX',  'North West', ST_GeogFromText('SRID=4326;POINT(-2.2270 53.4100)')),
  ('Manchester (Stretford)', 'Manchester',  'M32 8QA',  'North West', ST_GeogFromText('SRID=4326;POINT(-2.2900 53.4600)')),
  ('Liverpool (Norris Green)','Liverpool',  'L11 5AF',  'North West', ST_GeogFromText('SRID=4326;POINT(-2.9240 53.4370)')),
  ('Sheffield (Middlewood)', 'Sheffield',   'S6 1NE',   'Yorkshire', ST_GeogFromText('SRID=4326;POINT(-1.5100 53.4060)')),
  ('Newcastle (Gosforth)',   'Newcastle',   'NE3 3XT',  'North East', ST_GeogFromText('SRID=4326;POINT(-1.6050 55.0000)')),
  ('Bradford',               'Bradford',   'BD7 2EN',   'Yorkshire', ST_GeogFromText('SRID=4326;POINT(-1.7660 53.7950)'))
ON CONFLICT DO NOTHING;

-- South West England
INSERT INTO test_centres (name, town, postcode, region, location) VALUES
  ('Bristol (Brislington)', 'Bristol',   'BS4 3RB', 'South West', ST_GeogFromText('SRID=4326;POINT(-2.5450 51.4340)')),
  ('Exeter',                'Exeter',    'EX2 7JG', 'South West', ST_GeogFromText('SRID=4326;POINT(-3.5250 50.7200)')),
  ('Plymouth',              'Plymouth',  'PL4 9HU', 'South West', ST_GeogFromText('SRID=4326;POINT(-4.1400 50.3780)')),
  ('Swindon',               'Swindon',   'SN3 4TU', 'South West', ST_GeogFromText('SRID=4326;POINT(-1.7600 51.5600)'))
ON CONFLICT DO NOTHING;

-- East of England
INSERT INTO test_centres (name, town, postcode, region, location) VALUES
  ('Cambridge',             'Cambridge', 'CB1 8DX', 'East of England', ST_GeogFromText('SRID=4326;POINT(0.1580 52.2000)')),
  ('Ipswich',               'Ipswich',   'IP3 8SP', 'East of England', ST_GeogFromText('SRID=4326;POINT(1.1800 52.0430)')),
  ('Norwich',               'Norwich',   'NR6 5QQ', 'East of England', ST_GeogFromText('SRID=4326;POINT(1.2950 52.6560)')),
  ('Stevenage',             'Stevenage', 'SG1 3RB', 'East of England', ST_GeogFromText('SRID=4326;POINT(-0.2000 51.9050)'))
ON CONFLICT DO NOTHING;

-- --- demo contributor account ------------------------------------------------
-- password hashed with bcrypt via pgcrypto (compatible with Node bcrypt.compare)
INSERT INTO users (id, email, email_verified, password_hash, display_name, role)
VALUES ('11111111-1111-1111-1111-111111111111', 'demo@routesync.uk', TRUE,
        crypt('Password123!', gen_salt('bf', 10)), 'Demo Driver', 'admin')
ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin';

INSERT INTO auth_identities (id, user_id, provider, provider_uid)
VALUES (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'email', 'demo@routesync.uk')
ON CONFLICT (provider, provider_uid) DO NOTHING;

INSERT INTO subscriptions (id, user_id, plan, status, source, current_period_end, price_minor)
VALUES (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'premium_yearly', 'active',
        'stripe', now() + interval '1 year', 2999)
ON CONFLICT DO NOTHING;

INSERT INTO contributors (user_id, bio, credits, reputation, routes_published, instructor_status)
VALUES ('11111111-1111-1111-1111-111111111111', 'Seed demo account', 10, 25, 1, 'none')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO contributor_agreements (id, user_id, version)
VALUES (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '2026-01')
ON CONFLICT (user_id, version) DO NOTHING;

-- --- sample published route --------------------------------------------------
-- clean any previous seed of this route so child rows re-seed cleanly
DELETE FROM routes WHERE id = '22222222-2222-2222-2222-222222222222';

INSERT INTO routes (id, contributor_id, title, description, status, difficulty,
                    test_centre_id, town, postcode, distance_m, duration_s,
                    junction_count, roundabout_count, complexity_score, quality_score,
                    sync_confidence, track_geom, is_sample, is_instructor, has_captions,
                    published_at)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'Mill Hill test route', 'A representative Mill Hill test-centre route.',
        'published', 'test_standard',
        '33333333-3333-3333-3333-333333333333', 'Mill Hill', 'NW7', 8200, 60,
        12, 4, 62.5, 86, 0.82,
        ST_GeogFromText('SRID=4326;LINESTRING(-0.2470 51.6023, -0.2455 51.6031, -0.2438 51.6042, -0.2420 51.6050)'),
        TRUE, TRUE, FALSE, now());

-- videos (point at a public HLS test stream so playback works end-to-end)
INSERT INTO route_videos (id, route_id, view, rendition, storage_key, manifest_key,
                          codec, width, height, fps, duration_s, sync_offset_ms) VALUES
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'front', 'hls',
     'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
     'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'h264', 1280, 720, 30, 60, 0),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'rear', 'hls',
     'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
     'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'h264', 1280, 720, 30, 60, 0);

INSERT INTO route_gpx (id, route_id, storage_key, point_count, recorded_at, gps_quality)
VALUES (gen_random_uuid(), '22222222-2222-2222-2222-222222222222',
        'routes/22222222/track.gpx', 600, now(), 92);

INSERT INTO route_previews (route_id, thumbnail_key, map_preview_key)
VALUES ('22222222-2222-2222-2222-222222222222', 'routes/22222222/preview/thumbnail.jpg', NULL);

INSERT INTO route_quality_scores (route_id, gps_quality, video_quality, completeness,
                                  sync_confidence, contributor_rep, overall, details)
VALUES ('22222222-2222-2222-2222-222222222222', 92, 80, 95, 82, 50, 86,
        '{"note":"seed"}');

-- practice-mode instructions (UK English)
INSERT INTO route_instructions (id, route_id, seq, t_ms, type, text_ukenglish, roundabout_exit, speed_limit_mph) VALUES
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 0, 0,     'start',           'Start the route when ready',                     NULL, NULL),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 1, 4000,  'turn_left',       'In 200 yards, turn left onto the High Street',    NULL, 30),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 2, 10000, 'continue',        'Continue straight ahead',                         NULL, 30),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 3, 16000, 'roundabout_exit', 'At the roundabout, take the second exit',         2,    NULL),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 4, 24000, 'turn_right',      'Turn right at the traffic lights',                NULL, NULL),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 5, 32000, 'continue',        'Follow the road for half a mile',                 NULL, 40),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 6, 42000, 'destination',     'You have reached the end of the route',           NULL, NULL);

-- timeline markers
INSERT INTO route_markers (id, route_id, t_ms, kind, label) VALUES
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 8000,  'junction',   'Turn left onto the High Street'),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 16000, 'roundabout', 'Roundabout — second exit'),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 24000, 'junction',   'Turn right at the lights');

INSERT INTO route_fingerprints (route_id, geom_hash, distance_bucket)
VALUES ('22222222-2222-2222-2222-222222222222', 'seed-millhill-hash', 32)
ON CONFLICT (route_id) DO NOTHING;

COMMIT;
