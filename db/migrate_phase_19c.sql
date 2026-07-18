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
