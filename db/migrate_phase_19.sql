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
