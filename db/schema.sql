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
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  price_minor        INTEGER,                          -- pence
  currency           CHAR(3) NOT NULL DEFAULT 'GBP',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_sub_active_per_user ON subscriptions(user_id)
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

COMMIT;
