-- =============================================================================
-- RouteSync — additional seed data (admin account, more routes, review queue)
-- =============================================================================
-- Idempotent. Run after seed.sql:
--   docker compose -f infra/docker-compose.yml exec -T postgres \
--     psql -U routesync -d routesync < db/seed_more.sql
--
-- Adds:
--   * an admin account            admin@routesync.uk / Password123!
--   * 3 more PUBLISHED routes (fuller Discover; watchable)
--   * 3 routes in the REVIEW QUEUE (in_review / flagged) for the admin dashboard
-- =============================================================================

BEGIN;

-- --- admin account -----------------------------------------------------------
INSERT INTO users (id, email, email_verified, password_hash, display_name, role)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@routesync.uk', TRUE,
        crypt('Password123!', gen_salt('bf', 10)), 'RouteSync Admin', 'admin')
ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin';

INSERT INTO auth_identities (id, user_id, provider, provider_uid)
VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'email', 'admin@routesync.uk')
ON CONFLICT (provider, provider_uid) DO NOTHING;

INSERT INTO subscriptions (id, user_id, plan, status, source, current_period_end, price_minor)
VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'premium_yearly', 'active',
        'stripe', now() + interval '1 year', 2999)
ON CONFLICT DO NOTHING;

-- --- helper: contributor + a video pair for a route --------------------------
-- (inlined per route below; kept explicit for clarity)

-- clear previous extra-seed routes so this is idempotent
DELETE FROM routes WHERE id IN (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777',
  '88888888-8888-8888-8888-888888888888',
  '99999999-9999-9999-9999-999999999999'
);

-- --- 3 more PUBLISHED routes (watchable) -------------------------------------
INSERT INTO routes (id, contributor_id, title, status, difficulty, test_centre_id, town, postcode,
                    distance_m, duration_s, junction_count, roundabout_count, quality_score,
                    sync_confidence, is_sample, is_instructor, published_at) VALUES
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
     'Isleworth town loop', 'published', 'intermediate',
     (SELECT id FROM test_centres WHERE name='Isleworth' LIMIT 1), 'Isleworth', 'TW7',
     6100, 60, 9, 3, 74, 0.78, FALSE, FALSE, now()),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
     'Yeading residential & dual carriageway', 'published', 'beginner',
     (SELECT id FROM test_centres WHERE name='Hayes (Yeading)' LIMIT 1), 'Hayes', 'UB4',
     5400, 60, 7, 2, 68, 0.71, FALSE, FALSE, now()),
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
     'Wood Green busy junctions', 'published', 'advanced',
     (SELECT id FROM test_centres WHERE name='Wood Green' LIMIT 1), 'Wood Green', 'N22',
     7300, 60, 14, 5, 81, 0.80, FALSE, TRUE, now());

-- videos for the published extras (public HLS test stream, so they play)
INSERT INTO route_videos (id, route_id, view, rendition, storage_key, manifest_key, codec, width, height, fps, duration_s, sync_offset_ms)
SELECT gen_random_uuid(), r.id, v.view, 'hls',
       'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
       'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'h264', 1280, 720, 30, 60, 0
FROM (VALUES
  ('44444444-4444-4444-4444-444444444444'::uuid),
  ('55555555-5555-5555-5555-555555555555'::uuid),
  ('66666666-6666-6666-6666-666666666666'::uuid)
) AS r(id)
CROSS JOIN (VALUES ('front'::camera_view), ('rear'::camera_view)) AS v(view);

-- --- 3 routes in the REVIEW QUEUE (for the admin dashboard) -------------------
INSERT INTO routes (id, contributor_id, title, status, difficulty, test_centre_id, town, postcode,
                    distance_m, duration_s, junction_count, roundabout_count, quality_score,
                    sync_confidence, is_instructor, created_at) VALUES
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
     'Mill Hill evening route (pending)', 'in_review', 'test_standard',
     '33333333-3333-3333-3333-333333333333', 'Mill Hill', 'NW7',
     8600, 62, 13, 4, 79, 0.76, FALSE, now() - interval '2 hours'),
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
     'Instructor demo route (pending, fast-track)', 'in_review', 'advanced',
     (SELECT id FROM test_centres WHERE name='Wanstead' LIMIT 1), 'Wanstead', 'E11',
     9100, 61, 16, 6, 88, 0.85, TRUE, now() - interval '1 hour'),
  ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111',
     'Isleworth night drive (flagged)', 'flagged', 'intermediate',
     (SELECT id FROM test_centres WHERE name='Isleworth' LIMIT 1), 'Isleworth', 'TW7',
     5900, 60, 8, 2, 41, 0.38, FALSE, now() - interval '30 minutes');

-- quality-score detail rows for the review-queue items
INSERT INTO route_quality_scores (route_id, gps_quality, video_quality, completeness, sync_confidence, contributor_rep, overall, details) VALUES
  ('77777777-7777-7777-7777-777777777777', 82, 78, 90, 76, 50, 79, '{"flags":[]}'),
  ('88888888-8888-8888-8888-888888888888', 90, 86, 95, 85, 70, 88, '{"flags":[]}'),
  ('99999999-9999-9999-9999-999999999999', 45, 60, 70, 38, 50, 41, '{"flags":["low_gps_quality","low_sync_confidence"]}')
ON CONFLICT (route_id) DO NOTHING;

-- --- pending instructor verifications (for admin Instructors panel) ----------
INSERT INTO users (id, email, email_verified, password_hash, display_name, role) VALUES
  ('55555551-0000-0000-0000-000000000001','james.carter@example.com',  TRUE, crypt('Password123!',gen_salt('bf',10)), 'James Carter', 'contributor'),
  ('55555552-0000-0000-0000-000000000002','priya.sharma@example.com',  TRUE, crypt('Password123!',gen_salt('bf',10)), 'Priya Sharma', 'contributor'),
  ('55555553-0000-0000-0000-000000000003','tom.briggs@example.com',    TRUE, crypt('Password123!',gen_salt('bf',10)), 'Tom Briggs',   'contributor')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth_identities (id, user_id, provider, provider_uid) VALUES
  (gen_random_uuid(),'55555551-0000-0000-0000-000000000001','email','james.carter@example.com'),
  (gen_random_uuid(),'55555552-0000-0000-0000-000000000002','email','priya.sharma@example.com'),
  (gen_random_uuid(),'55555553-0000-0000-0000-000000000003','email','tom.briggs@example.com')
ON CONFLICT (provider, provider_uid) DO NOTHING;

INSERT INTO subscriptions (id, user_id, plan, status) VALUES
  (gen_random_uuid(),'55555551-0000-0000-0000-000000000001','free','active'),
  (gen_random_uuid(),'55555552-0000-0000-0000-000000000002','free','active'),
  (gen_random_uuid(),'55555553-0000-0000-0000-000000000003','free','active')
ON CONFLICT DO NOTHING;

INSERT INTO contributors (user_id, credits, reputation, routes_published, instructor_status) VALUES
  ('55555551-0000-0000-0000-000000000001', 0,  0, 0, 'pending'),
  ('55555552-0000-0000-0000-000000000002', 5, 10, 1, 'pending'),
  ('55555553-0000-0000-0000-000000000003', 0,  0, 0, 'pending')
ON CONFLICT (user_id) DO UPDATE SET instructor_status = 'pending';

INSERT INTO instructor_verifications (id, user_id, adi_number, evidence_url, status) VALUES
  ('66666661-0000-0000-0000-000000000001','55555551-0000-0000-0000-000000000001','ADI78341','https://example.com/adi-cert-james.pdf','pending'),
  ('66666662-0000-0000-0000-000000000002','55555552-0000-0000-0000-000000000002','ADI22198','https://example.com/adi-cert-priya.pdf','pending'),
  ('66666663-0000-0000-0000-000000000003','55555553-0000-0000-0000-000000000003','ADI56712', NULL,                                   'pending')
ON CONFLICT (id) DO NOTHING;

COMMIT;
