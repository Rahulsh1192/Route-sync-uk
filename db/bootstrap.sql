-- ==========================================================================
-- RouteSync — one-shot database bootstrap (schema + migrations + seed data)
-- Generated for a fresh managed Postgres (e.g. Supabase free tier).
-- Paste this WHOLE file into the Supabase SQL editor and run it once.
-- Requires PostGIS: run  create extension if not exists postgis;  first if needed.
-- Files are concatenated in the exact order verified locally.
-- ==========================================================================


-- ========================= db/schema.sql =========================

-- =============================================================================
-- RouteSync — PostgreSQL 16 + PostGIS schema  (deliverable #4)
-- =============================================================================
-- Conventions:
--   * UUID v4 primary keys (gen_random_uuid from pgcrypto)
--   * timestamptz everywhere, UTC
--   * soft-delete via deleted_at where user-facing
--   * money stored as integer minor units (pence) + currency code
--   * geometry/geography in SRID 4326 (WGS84), with GiST indexes
--   * forward-only migration; run as one transaction
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS postgis;      -- spatial types
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- fuzzy text search
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive email

-- -----------------------------------------------------------------------------
-- ENUM types
-- -----------------------------------------------------------------------------
CREATE TYPE user_role            AS ENUM ('user','contributor','instructor','moderator','admin');
CREATE TYPE auth_provider        AS ENUM ('email','google','apple');
CREATE TYPE subscription_plan    AS ENUM ('free','premium_monthly','premium_yearly');
CREATE TYPE subscription_status  AS ENUM ('active','trialing','past_due','canceled','expired');
CREATE TYPE billing_source       AS ENUM ('stripe','apple','google');
CREATE TYPE route_status         AS ENUM ('draft','processing','flagged','in_review','published','rejected','archived');
CREATE TYPE route_difficulty     AS ENUM ('beginner','intermediate','advanced','test_standard');
CREATE TYPE camera_view          AS ENUM ('front','rear');
CREATE TYPE video_rendition      AS ENUM ('master','hls','dash','thumbnail','sprite');
CREATE TYPE upload_status        AS ENUM ('created','uploading','queued','processing','flagged','completed','failed');
CREATE TYPE pipeline_stage       AS ENUM (
  'ingest','probe','clip_sort','gap_detect','overlap_detect','merge','reencode',
  'front_rear_reconcile','sync_engine','gps_validate','video_validate',
  'ai_privacy_blur','transcode','preview_gen','duplicate_check','quality_score','ready');
CREATE TYPE stage_state          AS ENUM ('pending','running','done','flagged','failed','skipped');
CREATE TYPE approval_decision    AS ENUM ('pending','approved','rejected','changes_requested');
CREATE TYPE instructor_status    AS ENUM ('none','pending','verified','rejected');
CREATE TYPE fund_entry_type      AS ENUM ('contribution','allocation','payout','adjustment');
CREATE TYPE notification_channel AS ENUM ('push','email','in_app');
CREATE TYPE takedown_status      AS ENUM ('open','reviewing','actioned','rejected');

-- -----------------------------------------------------------------------------
-- USERS & AUTH
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT UNIQUE,                       -- nullable for OAuth-only edge cases
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash   TEXT,                                -- null for OAuth-only users
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  role            user_role NOT NULL DEFAULT 'user',
  locale          TEXT NOT NULL DEFAULT 'en-GB',
  is_suspended    BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE auth_identities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        auth_provider NOT NULL,
  provider_uid    TEXT NOT NULL,                       -- sub from OAuth / email
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,                       -- store hash, never raw
  user_agent      TEXT,
  ip              INET,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- SUBSCRIPTIONS  (source of truth, fed by Stripe + RevenueCat webhooks)
-- -----------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan               subscription_plan NOT NULL DEFAULT 'free',
  status             subscription_status NOT NULL DEFAULT 'active',
  source             billing_source,
  external_id        TEXT,                             -- stripe sub id / store transaction
  -- Premium is purchased PER TEST CENTRE and is not switchable: one active
  -- subscription unlocks unlimited routes for exactly this centre. A user
  -- preparing at multiple centres holds one active subscription per centre.
  -- NULL = a legacy/universal subscription (grandfathered to cover all centres).
  -- FK to test_centres added after that table is defined (see below).
  test_centre_id     UUID,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  price_minor        INTEGER,                          -- pence
  currency           CHAR(3) NOT NULL DEFAULT 'GBP',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One active subscription per (user, test centre). NULLs are distinct in a
-- unique index, so legacy universal rows (test_centre_id IS NULL) never collide.
CREATE UNIQUE INDEX idx_sub_active_per_user_centre
  ON subscriptions(user_id, test_centre_id)
  WHERE status IN ('active','trialing','past_due');

CREATE TABLE subscription_events (              -- audit of every webhook (dunning, refund…)
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  source        billing_source NOT NULL,
  event_type    TEXT NOT NULL,                  -- e.g. invoice.paid, RENEWAL, REFUND
  payload       JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- TEST CENTRES (UK driving test centres) — spatial
-- -----------------------------------------------------------------------------
CREATE TABLE test_centres (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  town        TEXT,
  postcode    TEXT,
  region      TEXT,
  location    GEOGRAPHY(Point,4326) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_test_centres_geo ON test_centres USING GIST (location);
CREATE INDEX idx_test_centres_postcode ON test_centres (postcode);
CREATE INDEX idx_test_centres_town_trgm ON test_centres USING GIN (town gin_trgm_ops);

-- Per-centre Premium: link a subscription to the test centre it unlocks.
ALTER TABLE subscriptions
  ADD CONSTRAINT fk_subscriptions_test_centre
  FOREIGN KEY (test_centre_id) REFERENCES test_centres(id);
CREATE INDEX idx_subscriptions_test_centre ON subscriptions(test_centre_id);

-- -----------------------------------------------------------------------------
-- USER TEST DETAILS  (Phase 19b)
-- Every user must share their test centre + test date before using test routes.
-- Stored as history: each submission is a new row; the "current" details are the
-- most recent row per user. Keeps a trail as learners rebook / change centres.
-- -----------------------------------------------------------------------------
CREATE TABLE user_test_details (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_centre_id UUID NOT NULL REFERENCES test_centres(id),
  test_date      DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Latest-first lookup per user powers both the gate check and "current details".
CREATE INDEX idx_user_test_details_user ON user_test_details(user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- CONTRIBUTORS / INSTRUCTORS / COMMUNITY
-- -----------------------------------------------------------------------------
CREATE TABLE contributors (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio             TEXT,
  credits         INTEGER NOT NULL DEFAULT 0,
  reputation      INTEGER NOT NULL DEFAULT 0,
  routes_published INTEGER NOT NULL DEFAULT 0,
  instructor_status instructor_status NOT NULL DEFAULT 'none',
  adi_number      TEXT,                          -- DVSA Approved Driving Instructor no.
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE instructor_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adi_number    TEXT NOT NULL,
  evidence_url  TEXT,
  status        instructor_status NOT NULL DEFAULT 'pending',
  reviewed_by   UUID REFERENCES users(id),
  review_notes  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);

CREATE TABLE badges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,             -- 'first_route','ten_routes','instructor'
  name        TEXT NOT NULL,
  description TEXT,
  icon_url    TEXT
);

CREATE TABLE contributor_badges (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id    UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE leaderboards (                      -- materialised per period
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period      TEXT NOT NULL,                     -- 'weekly:2026-W25','monthly:2026-06','alltime'
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank        INTEGER NOT NULL,
  score       INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period, user_id)
);
CREATE INDEX idx_leaderboard_period_rank ON leaderboards(period, rank);

-- Contributor agreement / footage licensing (GAP: footage rights)
CREATE TABLE contributor_agreements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip            INET,
  UNIQUE (user_id, version)
);

-- -----------------------------------------------------------------------------
-- ROUTES (core entity)
-- -----------------------------------------------------------------------------
CREATE TABLE routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title           TEXT NOT NULL,
  description     TEXT,
  status          route_status NOT NULL DEFAULT 'draft',
  difficulty      route_difficulty,
  test_centre_id  UUID REFERENCES test_centres(id),
  town            TEXT,
  postcode        TEXT,
  -- denormalised stats for fast listing/sorting
  distance_m      INTEGER,
  duration_s      INTEGER,
  junction_count  INTEGER,
  roundabout_count INTEGER,
  complexity_score NUMERIC(5,2),
  quality_score   INTEGER,                       -- 0..100, see route_quality_scores
  sync_confidence NUMERIC(5,2),                  -- 0..1
  -- geometry of the whole track + bounding box for spatial search
  track_geom      GEOGRAPHY(LineString,4326),
  is_sample       BOOLEAN NOT NULL DEFAULT FALSE, -- free-tier sample route
  is_seed         BOOLEAN NOT NULL DEFAULT FALSE, -- cold-start seed content
  is_instructor   BOOLEAN NOT NULL DEFAULT FALSE, -- premium-gated instructor route
  has_captions    BOOLEAN NOT NULL DEFAULT FALSE, -- accessibility
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_routes_status ON routes(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_routes_test_centre ON routes(test_centre_id);
CREATE INDEX idx_routes_contributor ON routes(contributor_id);
CREATE INDEX idx_routes_geo ON routes USING GIST (track_geom);
CREATE INDEX idx_routes_quality ON routes(quality_score DESC) WHERE status='published';
CREATE INDEX idx_routes_search ON routes USING GIN (
  to_tsvector('english', coalesce(title,'') || ' ' || coalesce(town,'') || ' ' || coalesce(postcode,'')));

-- -----------------------------------------------------------------------------
-- DEMO ROUTE CLAIMS  (Phase 19c)
-- A non-Premium (demo) user gets ONE route total across the whole account, and
-- that route must belong to their declared test centre. The first route they
-- open is claimed here; PK on user_id enforces exactly one per account.
-- -----------------------------------------------------------------------------
CREATE TABLE demo_route_claims (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  route_id    UUID NOT NULL REFERENCES routes(id),
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- merged/processed videos and renditions
CREATE TABLE route_videos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id      UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  view          camera_view NOT NULL,
  rendition     video_rendition NOT NULL,
  storage_key   TEXT NOT NULL,                   -- R2/MinIO object key
  codec         TEXT,                            -- h264 / h265
  width         INTEGER,
  height        INTEGER,
  fps           NUMERIC(5,2),
  duration_s    NUMERIC(10,3),
  bytes         BIGINT,
  manifest_key  TEXT,                            -- HLS/DASH manifest object key
  sync_offset_ms INTEGER NOT NULL DEFAULT 0,     -- from sync engine
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_route_videos_route ON route_videos(route_id);

-- GPX track + parsed points
CREATE TABLE route_gpx (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id      UUID NOT NULL UNIQUE REFERENCES routes(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  point_count   INTEGER,
  recorded_at   TIMESTAMPTZ,
  gps_quality   INTEGER,                          -- 0..100 (see validation)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- optional: dense track points for telemetry/playback (could be parquet in R2 instead)
CREATE TABLE route_track_points (
  route_id      UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  t_ms          INTEGER NOT NULL,                 -- ms from route start (master clock)
  location      GEOGRAPHY(Point,4326) NOT NULL,
  elevation_m   NUMERIC(7,2),
  speed_mps     NUMERIC(6,2),
  PRIMARY KEY (route_id, seq)
);

-- navigation instructions for practice mode (derived from GPX via Valhalla)
CREATE TABLE route_instructions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id      UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  t_ms          INTEGER NOT NULL,
  type          TEXT NOT NULL,                    -- turn_left, turn_right, roundabout_exit…
  text_ukenglish TEXT NOT NULL,                   -- "At the roundabout, take the second exit"
  roundabout_exit INTEGER,
  speed_limit_mph INTEGER,
  location      GEOGRAPHY(Point,4326),
  UNIQUE (route_id, seq)
);

-- junctions / roundabouts markers for playback timeline
CREATE TABLE route_markers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id      UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  t_ms          INTEGER NOT NULL,
  kind          TEXT NOT NULL,                    -- junction, roundabout, hazard
  label         TEXT,
  location      GEOGRAPHY(Point,4326)
);
CREATE INDEX idx_route_markers_route ON route_markers(route_id);

CREATE TABLE route_previews (
  route_id        UUID PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
  thumbnail_key   TEXT,
  map_preview_key TEXT,
  sprite_key      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE route_statistics (                   -- time-series of views/engagement
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id      UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  day           DATE NOT NULL,
  views         INTEGER NOT NULL DEFAULT 0,
  watch_seconds BIGINT NOT NULL DEFAULT 0,
  practice_runs INTEGER NOT NULL DEFAULT 0,
  downloads     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (route_id, day)
);
CREATE INDEX idx_route_stats_route ON route_statistics(route_id, day);

CREATE TABLE route_quality_scores (
  route_id            UUID PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
  gps_quality         INTEGER,                    -- 0..100
  video_quality       INTEGER,                    -- 0..100
  completeness        INTEGER,                    -- 0..100
  sync_confidence     INTEGER,                    -- 0..100
  contributor_rep     INTEGER,                    -- 0..100 normalised
  overall             INTEGER NOT NULL,           -- 0..100 weighted
  details             JSONB,                      -- per-factor breakdown + flags
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- duplicate detection fingerprints (GPX geometry + road/junction sequence hash)
CREATE TABLE route_fingerprints (
  route_id        UUID PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
  geom_hash       TEXT NOT NULL,                  -- geohash polyline signature
  distance_bucket INTEGER,                        -- rounded distance for fast prefilter
  road_seq_hash   TEXT,
  junction_seq_hash TEXT,
  simplified_geom GEOGRAPHY(LineString,4326),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fingerprint_geomhash ON route_fingerprints(geom_hash);
CREATE INDEX idx_fingerprint_distance ON route_fingerprints(distance_bucket);

-- -----------------------------------------------------------------------------
-- UPLOADS + PROCESSING PIPELINE
-- -----------------------------------------------------------------------------
CREATE TABLE uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id        UUID REFERENCES routes(id) ON DELETE SET NULL,
  status          upload_status NOT NULL DEFAULT 'created',
  clock_source    TEXT,                           -- 'gps','camera_gps','file_mtime'
  notes           TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_uploads_user ON uploads(user_id);
CREATE INDEX idx_uploads_status ON uploads(status);

-- each raw clip / gpx file belonging to an upload
CREATE TABLE upload_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id     UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                    -- 'front','rear','gpx'
  storage_key   TEXT NOT NULL,
  original_name TEXT,
  bytes         BIGINT,
  -- probed metadata
  started_at    TIMESTAMPTZ,                      -- clip creation time
  duration_s    NUMERIC(10,3),
  codec         TEXT,
  width         INTEGER,
  height        INTEGER,
  fps           NUMERIC(5,2),
  ordinal       INTEGER,                          -- computed sort order within camera
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_upload_files_upload ON upload_files(upload_id);

-- per-stage progress + findings (gaps, overlaps, drift, scores…)
CREATE TABLE upload_stages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id     UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  stage         pipeline_stage NOT NULL,
  state         stage_state NOT NULL DEFAULT 'pending',
  progress      NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 0..100
  findings      JSONB,                            -- {gaps:[...], overlaps:[...], drift_ms:..}
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  UNIQUE (upload_id, stage)
);

-- -----------------------------------------------------------------------------
-- MODERATION / APPROVALS / ABUSE
-- -----------------------------------------------------------------------------
CREATE TABLE approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id      UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  reviewer_id   UUID REFERENCES users(id),
  decision      approval_decision NOT NULL DEFAULT 'pending',
  fast_tracked  BOOLEAN NOT NULL DEFAULT FALSE,   -- verified instructor boost
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ
);
CREATE INDEX idx_approvals_route ON approvals(route_id);
CREATE INDEX idx_approvals_pending ON approvals(decision) WHERE decision='pending';

CREATE TABLE moderation_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID REFERENCES users(id),
  target_type   TEXT NOT NULL,                    -- 'route','user','comment'
  target_id     UUID NOT NULL,
  action        TEXT NOT NULL,                    -- 'reject','suspend','blur_redo'…
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (                            -- user-reported content (GAP: abuse)
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  target_type   TEXT NOT NULL,
  target_id     UUID NOT NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- INSTRUCTOR COMMUNITY FUND  (10% of net profit; transparent ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE fund_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type    fund_entry_type NOT NULL,
  amount_minor  BIGINT NOT NULL,                  -- pence; sign per entry_type
  currency      CHAR(3) NOT NULL DEFAULT 'GBP',
  period        TEXT,                             -- 'monthly:2026-06'
  description   TEXT,
  -- traceability of the "net profit" formula inputs
  net_profit_minor BIGINT,
  allocation_pct NUMERIC(5,2),                    -- e.g. 10.00
  beneficiary_id UUID,                            -- FK set below
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fund_tx_period ON fund_transactions(period);

CREATE TABLE fund_beneficiaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  user_id       UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE fund_transactions
  ADD CONSTRAINT fk_fund_beneficiary FOREIGN KEY (beneficiary_id)
  REFERENCES fund_beneficiaries(id);

-- -----------------------------------------------------------------------------
-- NOTIFICATIONS  (GAP: notifications)
-- -----------------------------------------------------------------------------
CREATE TABLE device_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,                    -- 'ios','android'
  token         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel       notification_channel NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  data          JSONB,
  read_at       TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- OFFLINE PACKAGES  (GAP: offline mode bookkeeping)
-- -----------------------------------------------------------------------------
CREATE TABLE offline_packages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id      UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,                    -- compressed encrypted package
  bytes         BIGINT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, route_id)
);

-- -----------------------------------------------------------------------------
-- GDPR / PRIVACY / COMPLIANCE  (GAP: public-road footage, consent, takedown)
-- -----------------------------------------------------------------------------
CREATE TABLE consent_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  consent_type  TEXT NOT NULL,                    -- 'privacy_policy','footage_processing'
  version       TEXT NOT NULL,
  granted       BOOLEAN NOT NULL,
  ip            INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE takedown_requests (                  -- e.g. "blur missed my plate/face"
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id      UUID REFERENCES routes(id) ON DELETE SET NULL,
  requester_email CITEXT,
  reason        TEXT NOT NULL,
  status        takedown_status NOT NULL DEFAULT 'open',
  handled_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE TABLE data_requests (                      -- GDPR export/erasure tracking
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                    -- 'export','erasure'
  status        TEXT NOT NULL DEFAULT 'pending',
  result_key    TEXT,                             -- export package location
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

-- -----------------------------------------------------------------------------
-- USAGE QUOTAS / COST CONTROL  (GAP: cost controls)
-- -----------------------------------------------------------------------------
CREATE TABLE usage_quotas (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  period             TEXT NOT NULL,               -- 'monthly:2026-06'
  uploads_count      INTEGER NOT NULL DEFAULT 0,
  upload_bytes       BIGINT NOT NULL DEFAULT 0,
  processing_seconds BIGINT NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- AUDIT LOG  (admin / money / GDPR actions)
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      UUID REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     UUID,
  before        JSONB,
  after         JSONB,
  ip            INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- updated_at trigger helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','subscriptions','routes','uploads'] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- =============================================================================
-- PHASE 14 — VIDEO-LESS ROUTES (map_only state + deferred video attach)
-- =============================================================================

-- Extend route_status enum to support GPS-only published routes
ALTER TYPE route_status ADD VALUE IF NOT EXISTS 'map_only';

-- Track whether a route has video and who contributed the video (may differ
-- from the original GPS contributor — any verified ADI can attach video).
ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS has_video         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS video_contributor_id UUID REFERENCES users(id);

-- Unique ADI licence: one ADI number can only be verified to one account.
-- Phase 17 — prevents account sharing between instructors.
ALTER TABLE instructor_verifications
  ADD CONSTRAINT uq_adi_number_verified UNIQUE (adi_number, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_adi_number_active
  ON instructor_verifications(adi_number)
  WHERE status = 'verified';

-- =============================================================================
-- PHASE 15 — LEARNER PROGRESS TRACKING & AI LEARNING SUMMARIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_route_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id          UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  watch_count       INTEGER NOT NULL DEFAULT 0,
  practice_count    INTEGER NOT NULL DEFAULT 0,
  watch_pct_max     NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 0..100, furthest % reached
  last_watched_at   TIMESTAMPTZ,
  last_practised_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, route_id)
);
CREATE INDEX idx_urh_user ON user_route_history(user_id, last_watched_at DESC);
CREATE INDEX idx_urh_route ON user_route_history(route_id);

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

CREATE TYPE ai_session_type AS ENUM ('watch', 'practice');

CREATE TABLE IF NOT EXISTS ai_summaries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id     UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  session_type ai_session_type NOT NULL,
  summary_text TEXT NOT NULL,
  focus_areas  JSONB,           -- [{area: "roundabout exit 2", tip: "..."}, ...]
  model        TEXT,            -- 'gpt-4o', 'gemini-1.5-pro', etc.
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, route_id, session_type)
);
CREATE INDEX idx_ai_summaries_user ON ai_summaries(user_id, generated_at DESC);

-- =============================================================================
-- PHASE 16 — OFFLINE ROUTE PACKAGES (extend existing table)
-- =============================================================================

ALTER TABLE offline_packages
  ADD COLUMN IF NOT EXISTS device_id  TEXT,       -- bound device identifier
  ADD COLUMN IF NOT EXISTS checksum   TEXT;       -- SHA-256 of encrypted package

-- =============================================================================
-- PHASE 13 — ADI BOOKING SYSTEM
-- =============================================================================

CREATE TYPE booking_status AS ENUM ('pending','confirmed','cancelled','completed','no_show');

-- Rich instructor profile (supplements the core contributors table)
CREATE TABLE IF NOT EXISTS instructor_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio                 TEXT,
  years_experience    INTEGER,
  lesson_price_minor  INTEGER NOT NULL DEFAULT 3500,  -- pence (default £35)
  currency            CHAR(3) NOT NULL DEFAULT 'GBP',
  service_area_geom   GEOGRAPHY(Polygon,4326),        -- rough service area polygon
  service_area_km     NUMERIC(6,1),                   -- radius if using circle
  stripe_account_id   TEXT,                           -- Stripe Connect Express account
  stripe_onboarded    BOOLEAN NOT NULL DEFAULT FALSE,
  is_accepting_bookings BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_instructor_profiles_geo ON instructor_profiles USING GIST (service_area_geom);

-- Weekly availability template (Mon=1…Sun=7) — repeated slots
CREATE TABLE IF NOT EXISTS availability_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_avail_template_instructor ON availability_templates(instructor_id);

-- Concrete available slots (generated from template or manually added)
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
CREATE INDEX idx_avail_slots_instructor ON availability_slots(instructor_id, slot_date);
CREATE INDEX idx_avail_slots_open ON availability_slots(slot_date, is_booked) WHERE NOT is_booked;

-- Bookings
CREATE TABLE IF NOT EXISTS bookings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  instructor_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slot_id        UUID NOT NULL REFERENCES availability_slots(id) ON DELETE RESTRICT,
  status         booking_status NOT NULL DEFAULT 'pending',
  lesson_notes   TEXT,                            -- learner's note to instructor
  cancel_reason  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_learner ON bookings(learner_id, created_at DESC);
CREATE INDEX idx_bookings_instructor ON bookings(instructor_id, created_at DESC);
CREATE INDEX idx_bookings_status ON bookings(status);

-- Payment records for each booking (lesson fee + platform service fee)
CREATE TABLE IF NOT EXISTS booking_payments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount_minor           INTEGER NOT NULL,            -- total charged to learner (pence)
  lesson_fee_minor       INTEGER NOT NULL,            -- goes to instructor via Connect
  platform_fee_minor     INTEGER NOT NULL,            -- kept by RouteSync
  currency               CHAR(3) NOT NULL DEFAULT 'GBP',
  stripe_payment_intent  TEXT,
  stripe_transfer_id     TEXT,                        -- transfer to instructor account
  status                 TEXT NOT NULL DEFAULT 'pending',  -- pending/succeeded/failed/refunded
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_payments_booking ON booking_payments(booking_id);

-- Platform configuration (service fee %, etc.) — admin-editable without redeploy
CREATE TABLE IF NOT EXISTS platform_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);
-- Default platform booking fee: 10%
INSERT INTO platform_config (key, value) VALUES ('booking_fee_pct', '10')
  ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- PHASE 5 — UK DVSA TEST CENTRE SEED (via seed.sql) — schema complete above
-- =============================================================================

COMMIT;


-- ========================= db/migrate_phases_13_17.sql =========================

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


-- ========================= db/migrate_phase_19.sql =========================

-- ============================================================================
-- Phase 19 — Access & Pricing Model Corrections
-- Per-test-centre Premium (non-switchable): a subscription unlocks exactly one
-- test centre. A user may hold one active subscription per centre.
--
-- Safe to run on an existing database. Idempotent where practical.
-- Existing active subscriptions keep test_centre_id = NULL and are treated as
-- "universal" (grandfathered to cover all centres) by the entitlement check.
-- ============================================================================

BEGIN;

-- 1. Add the test centre link to subscriptions.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS test_centre_id UUID;

-- 2. FK + lookup index (guarded so re-runs don't error).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscriptions_test_centre'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT fk_subscriptions_test_centre
      FOREIGN KEY (test_centre_id) REFERENCES test_centres(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_test_centre
  ON subscriptions(test_centre_id);

-- 3. Replace the "one active subscription per user" uniqueness with
--    "one active subscription per (user, test centre)". NULLs are distinct in a
--    unique index, so legacy universal rows never collide with each other.
DROP INDEX IF EXISTS idx_sub_active_per_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_active_per_user_centre
  ON subscriptions(user_id, test_centre_id)
  WHERE status IN ('active','trialing','past_due');

COMMIT;


-- ========================= db/migrate_phase_19b.sql =========================

-- ============================================================================
-- Phase 19b — Test-details gate
-- Every user must share their test centre + test date before using test routes.
-- History table: each submission is a new row; "current" = the most recent row.
--
-- Safe to run on an existing database. Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS user_test_details (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_centre_id UUID NOT NULL REFERENCES test_centres(id),
  test_date      DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_test_details_user
  ON user_test_details(user_id, created_at DESC);

COMMIT;


-- ========================= db/migrate_phase_19c.sql =========================

-- ============================================================================
-- Phase 19c — Demo = one route total (account-wide), at the declared test centre
-- A non-Premium user may unlock exactly one route, and it must belong to the
-- test centre they declared (Phase 19b). The first route they open is claimed.
--
-- Safe to run on an existing database. Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS demo_route_claims (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  route_id    UUID NOT NULL REFERENCES routes(id),
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;


-- ========================= db/seed.sql =========================

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
ON CONFLICT (id) DO NOTHING;

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


-- ========================= db/seed_more.sql =========================

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


-- ========================= db/seed_booking_test.sql =========================

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

