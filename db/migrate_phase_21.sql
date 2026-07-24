-- ============================================================================
-- Phase 21 — Instructor revenue-share infrastructure (data + shadow engine)
--
-- LAUNCH DECISION: the instructor share of subscription revenue is ZERO at
-- launch (`revshare_instructor_pct = 0`). Instructors contribute route videos as
-- a social-welfare act (the Community Fund donates to people who need support)
-- and are rewarded by MARKETING exposure — their profile is shown while a learner
-- watches, driving lesson bookings. This migration builds the full, traceable
-- pipeline (watch-time logging + a signed earnings ledger + monthly attribution)
-- so a share can be switched on LATER by changing one config value — no redeploy,
-- no schema change. With the percentage at 0 the engine runs in "shadow mode":
-- it records watch-time and computes pools, but every instructor accrual is £0
-- and all subscription revenue stays with the platform (which funds the charity).
--
-- Idempotent: safe to run repeatedly on an already-migrated database.
-- ============================================================================

BEGIN;

-- Append-only record of what was actually watched. Never edited; the qualifying
-- threshold and per-day cap are applied later at aggregation, so raw truth is
-- preserved and the rules can be re-tuned retroactively.
CREATE TABLE IF NOT EXISTS route_watch_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id        UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_centre_id  UUID REFERENCES test_centres(id),   -- denormalised at insert
  source          TEXT NOT NULL DEFAULT 'playback',   -- 'playback' | 'practice'
  seconds_watched INTEGER NOT NULL,                   -- reported by client
  route_duration_s INTEGER,                           -- snapshot for the >=25% test
  watched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_watch_centre_time ON route_watch_events (test_centre_id, watched_at);
CREATE INDEX IF NOT EXISTS idx_watch_route_time  ON route_watch_events (route_id, watched_at);
CREATE INDEX IF NOT EXISTS idx_watch_user_route  ON route_watch_events (user_id, route_id, watched_at);

-- Signed, append-only ledger. An instructor's balance = SUM(amount_minor).
-- entry_type: content_accrual | chargeback_adjustment | payout | holdback
--             | holdback_release | manual_adjustment
CREATE TABLE IF NOT EXISTS instructor_earnings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period         TEXT,                                -- e.g. '2026-03'
  entry_type     TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,                    -- signed pence
  currency       CHAR(3) NOT NULL DEFAULT 'GBP',
  test_centre_id UUID REFERENCES test_centres(id),
  reference      TEXT,                                -- run id / transfer id / dispute id
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_earnings_instructor ON instructor_earnings (instructor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_earnings_period     ON instructor_earnings (period);

-- One reproducible attribution run per period. `config` snapshots the exact
-- knobs used so a run can always be explained and re-derived.
CREATE TABLE IF NOT EXISTS revshare_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period         TEXT NOT NULL UNIQUE,                -- '2026-03'
  status         TEXT NOT NULL DEFAULT 'draft',       -- draft | finalized | paid
  gross_minor    INTEGER NOT NULL DEFAULT 0,
  pool_minor     INTEGER NOT NULL DEFAULT 0,          -- instructor pool (0 at launch)
  platform_minor INTEGER NOT NULL DEFAULT 0,
  config         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at   TIMESTAMPTZ
);

-- The maths, one row per (run, instructor, centre).
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

-- Stripe Connect transfers (populated only once real payouts are enabled).
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

-- DB-tunable config (no redeploy). The instructor share starts at 0 — flip it to
-- e.g. 45 later to start paying instructors from subscription revenue.
INSERT INTO platform_config (key, value) VALUES
  ('revshare_instructor_pct', '0'),    -- 0 = charity + marketing model at launch
  ('revshare_min_view_seconds', '30'),
  ('revshare_min_view_pct', '25'),
  ('revshare_holdback_pct', '10'),
  ('revshare_holdback_days', '90'),
  ('revshare_min_payout_minor', '2000'),
  ('revshare_payout_day', '5')
  ON CONFLICT (key) DO NOTHING;

COMMIT;
