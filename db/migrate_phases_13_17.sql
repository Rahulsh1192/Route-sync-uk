-- =============================================================================
-- RouteSync — Incremental migration: Phases 13-17 new tables
-- Safe to run on the existing database (uses IF NOT EXISTS / IF VALUE NOT EXISTS)
-- =============================================================================

BEGIN;

-- Phase 14: map_only route status + columns
ALTER TYPE route_status ADD VALUE IF NOT EXISTS 'map_only';

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS has_video            BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS video_contributor_id UUID REFERENCES users(id);

-- Phase 17: unique ADI licence per verified account
CREATE UNIQUE INDEX IF NOT EXISTS uq_adi_number_active
  ON instructor_verifications(adi_number)
  WHERE status = 'verified';

-- Phase 15: Learner progress tracking
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_session_type') THEN
    CREATE TYPE ai_session_type AS ENUM ('watch', 'practice');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_route_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id          UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  watch_count       INTEGER NOT NULL DEFAULT 0,
  practice_count    INTEGER NOT NULL DEFAULT 0,
  watch_pct_max     NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_watched_at   TIMESTAMPTZ,
  last_practised_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, route_id)
);
CREATE INDEX IF NOT EXISTS idx_urh_user  ON user_route_history(user_id, last_watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_urh_route ON user_route_history(route_id);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_routes_watched INTEGER NOT NULL DEFAULT 0,
  total_practice_runs  INTEGER NOT NULL DEFAULT 0,
  total_watch_time_s   BIGINT  NOT NULL DEFAULT 0,
  current_streak_days  INTEGER NOT NULL DEFAULT 0,
  longest_streak_days  INTEGER NOT NULL DEFAULT 0,
  last_active_at       TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_summaries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id     UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  session_type ai_session_type NOT NULL,
  summary_text TEXT NOT NULL,
  focus_areas  JSONB,
  model        TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, route_id, session_type)
);
CREATE INDEX IF NOT EXISTS idx_ai_summaries_user ON ai_summaries(user_id, generated_at DESC);

-- Phase 16: Offline packages — extend existing table
ALTER TABLE offline_packages
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS checksum  TEXT;

-- Phase 13: ADI Booking System
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status') THEN
    CREATE TYPE booking_status AS ENUM ('pending','confirmed','cancelled','completed','no_show');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS instructor_profiles (
  user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio                   TEXT,
  years_experience      INTEGER,
  lesson_price_minor    INTEGER NOT NULL DEFAULT 3500,
  currency              CHAR(3) NOT NULL DEFAULT 'GBP',
  service_area_geom     GEOGRAPHY(Polygon,4326),
  service_area_km       NUMERIC(6,1),
  stripe_account_id     TEXT,
  stripe_onboarded      BOOLEAN NOT NULL DEFAULT FALSE,
  is_accepting_bookings BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_instructor_profiles_geo
  ON instructor_profiles USING GIST (service_area_geom);

CREATE TABLE IF NOT EXISTS availability_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_avail_template_instructor
  ON availability_templates(instructor_id);

CREATE TABLE IF NOT EXISTS availability_slots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_date     DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  is_booked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instructor_id, slot_date, start_time)
);
CREATE INDEX IF NOT EXISTS idx_avail_slots_instructor
  ON availability_slots(instructor_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_avail_slots_open
  ON availability_slots(slot_date, is_booked) WHERE NOT is_booked;

CREATE TABLE IF NOT EXISTS bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slot_id       UUID NOT NULL REFERENCES availability_slots(id) ON DELETE RESTRICT,
  status        booking_status NOT NULL DEFAULT 'pending',
  lesson_notes  TEXT,
  cancel_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_learner
  ON bookings(learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_instructor
  ON bookings(instructor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS booking_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount_minor          INTEGER NOT NULL,
  lesson_fee_minor      INTEGER NOT NULL,
  platform_fee_minor    INTEGER NOT NULL,
  currency              CHAR(3) NOT NULL DEFAULT 'GBP',
  stripe_payment_intent TEXT,
  stripe_transfer_id    TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking
  ON booking_payments(booking_id);

CREATE TABLE IF NOT EXISTS platform_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);
INSERT INTO platform_config (key, value)
  VALUES ('booking_fee_pct', '10')
  ON CONFLICT (key) DO NOTHING;

COMMIT;
