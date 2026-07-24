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
  address     TEXT,                                  -- Phase 20: full street address
  description TEXT,                                  -- Phase 20: notes shown on the centre page
  location    GEOGRAPHY(Point,4326) NOT NULL,        -- lat/lng auto-geocoded from postcode
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

-- =============================================================================
-- PHASE 21 — Instructor revenue-share infrastructure (data + shadow engine)
-- Instructor share starts at 0 (charity + marketing model); the full pipeline is
-- present so a share can be switched on later via platform_config alone. See
-- db/migrate_phase_21.sql for the rationale.
-- =============================================================================
CREATE TABLE IF NOT EXISTS route_watch_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id        UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_centre_id  UUID REFERENCES test_centres(id),
  source          TEXT NOT NULL DEFAULT 'playback',
  seconds_watched INTEGER NOT NULL,
  route_duration_s INTEGER,
  watched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_watch_centre_time ON route_watch_events (test_centre_id, watched_at);
CREATE INDEX IF NOT EXISTS idx_watch_route_time  ON route_watch_events (route_id, watched_at);
CREATE INDEX IF NOT EXISTS idx_watch_user_route  ON route_watch_events (user_id, route_id, watched_at);

CREATE TABLE IF NOT EXISTS instructor_earnings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period         TEXT,
  entry_type     TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'GBP',
  test_centre_id UUID REFERENCES test_centres(id),
  reference      TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_earnings_instructor ON instructor_earnings (instructor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_earnings_period     ON instructor_earnings (period);

CREATE TABLE IF NOT EXISTS revshare_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period         TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'draft',
  gross_minor    INTEGER NOT NULL DEFAULT 0,
  pool_minor     INTEGER NOT NULL DEFAULT 0,
  platform_minor INTEGER NOT NULL DEFAULT 0,
  config         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS revshare_run_lines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES revshare_runs(id) ON DELETE CASCADE,
  instructor_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_centre_id UUID REFERENCES test_centres(id),
  watch_seconds  BIGINT NOT NULL DEFAULT 0,
  share_pct      NUMERIC(6,3) NOT NULL DEFAULT 0,
  amount_minor   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_run_lines_run        ON revshare_run_lines (run_id);
CREATE INDEX IF NOT EXISTS idx_run_lines_instructor ON revshare_run_lines (instructor_id);

CREATE TABLE IF NOT EXISTS payouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period            TEXT,
  gross_minor       INTEGER NOT NULL DEFAULT 0,
  holdback_minor    INTEGER NOT NULL DEFAULT 0,
  net_minor         INTEGER NOT NULL DEFAULT 0,
  stripe_transfer_id TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payouts_instructor ON payouts (instructor_id, created_at);

INSERT INTO platform_config (key, value) VALUES
  ('revshare_instructor_pct', '0'),
  ('revshare_min_view_seconds', '30'),
  ('revshare_min_view_pct', '25'),
  ('revshare_holdback_pct', '10'),
  ('revshare_holdback_days', '90'),
  ('revshare_min_payout_minor', '2000'),
  ('revshare_payout_day', '5')
  ON CONFLICT (key) DO NOTHING;

COMMIT;
