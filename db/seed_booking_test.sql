BEGIN;

-- ── Test instructor account ─────────────────────────────────────────────────
INSERT INTO users (id, email, email_verified, password_hash, display_name, role)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'instructor@routesync.uk', TRUE,
  crypt('Password123!', gen_salt('bf', 10)),
  'Sarah Johnson (ADI)', 'instructor'
) ON CONFLICT (id) DO UPDATE SET role = 'instructor', display_name = EXCLUDED.display_name;

INSERT INTO auth_identities (id, user_id, provider, provider_uid)
VALUES (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'email', 'instructor@routesync.uk')
ON CONFLICT (provider, provider_uid) DO NOTHING;

INSERT INTO subscriptions (id, user_id, plan, status)
VALUES (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'free', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO contributors (user_id, bio, credits, reputation, routes_published, instructor_status, adi_number, verified_at)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'DSA-qualified ADI with 12 years experience in North London.',
  50, 120, 3, 'verified', 'ADI12345', now()
) ON CONFLICT (user_id) DO UPDATE SET instructor_status = 'verified', reputation = 120;

INSERT INTO contributor_agreements (id, user_id, version)
VALUES (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '2026-01')
ON CONFLICT (user_id, version) DO NOTHING;

INSERT INTO instructor_profiles (user_id, bio, years_experience, lesson_price_minor, is_accepting_bookings)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'Specialising in test-centre prep for Mill Hill, Barnet & Wood Green. 70%+ pass rate.',
  12, 3500, TRUE
) ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio;

-- Availability slots for the next 7 days
DELETE FROM availability_slots WHERE instructor_id = '22222222-2222-2222-2222-222222222222' AND is_booked = FALSE;

INSERT INTO availability_slots (id, instructor_id, slot_date, start_time, end_time)
VALUES
  ('aa000001-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', CURRENT_DATE + 1, '09:00', '10:00'),
  ('aa000001-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', CURRENT_DATE + 1, '11:00', '12:00'),
  ('aa000001-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', CURRENT_DATE + 2, '10:00', '11:00'),
  ('aa000001-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', CURRENT_DATE + 2, '14:00', '15:00'),
  ('aa000001-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', CURRENT_DATE + 3, '09:00', '10:00'),
  ('aa000001-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', CURRENT_DATE + 4, '10:00', '11:00'),
  ('aa000001-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', CURRENT_DATE + 5, '09:00', '10:00')
ON CONFLICT DO NOTHING;

-- ── Test learner account ────────────────────────────────────────────────────
INSERT INTO users (id, email, email_verified, password_hash, display_name, role)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'learner@routesync.uk', TRUE,
  crypt('Password123!', gen_salt('bf', 10)),
  'Alex (Learner)', 'user'
) ON CONFLICT (id) DO UPDATE SET role = 'user';

INSERT INTO auth_identities (id, user_id, provider, provider_uid)
VALUES (gen_random_uuid(), '44444444-4444-4444-4444-444444444444', 'email', 'learner@routesync.uk')
ON CONFLICT (provider, provider_uid) DO NOTHING;

INSERT INTO subscriptions (id, user_id, plan, status)
VALUES (gen_random_uuid(), '44444444-4444-4444-4444-444444444444', 'free', 'active')
ON CONFLICT DO NOTHING;

-- ── Sample confirmed booking ─────────────────────────────────────────────────
INSERT INTO bookings (id, learner_id, instructor_id, slot_id, status, lesson_notes)
VALUES (
  'bb000001-0000-0000-0000-000000000001',
  '44444444-4444-4444-4444-444444444444',
  '22222222-2222-2222-2222-222222222222',
  'aa000001-0000-0000-0000-000000000001',
  'confirmed',
  'Preparing for Mill Hill test. Need to work on roundabouts.'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO booking_payments (id, booking_id, amount_minor, lesson_fee_minor, platform_fee_minor, status)
VALUES (
  gen_random_uuid(),
  'bb000001-0000-0000-0000-000000000001',
  3850, 3500, 350, 'pending'
) ON CONFLICT DO NOTHING;

UPDATE availability_slots SET is_booked = TRUE WHERE id = 'aa000001-0000-0000-0000-000000000001';

COMMIT;
