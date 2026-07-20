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
