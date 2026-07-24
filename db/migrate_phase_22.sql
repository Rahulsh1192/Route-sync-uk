-- ============================================================================
-- Phase 22 — Subscription invoices (actual collected revenue, for rev-share)
--
-- Phase 21's rev-share engine approximates a period's gross from currently-active
-- subscriptions. That's fine for shadow validation, but once real money moves the
-- pool must be built from what was ACTUALLY charged in that period. This table is
-- the source of truth for collected subscription revenue:
--
--  * one row per successful subscription charge (Stripe invoice / RevenueCat
--    purchase or renewal), recorded from the billing webhook;
--  * `period_start`/`period_end` is the COVERAGE window the charge pays for, so a
--    yearly charge is amortised across the 12 months it covers (day-weighted) —
--    no payout spikes, smaller refund exposure;
--  * `refunded_minor` is netted off; a fully-refunded invoice contributes nothing;
--  * `(source, external_id)` is unique so replayed webhooks never double-count.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id  UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  test_centre_id   UUID REFERENCES test_centres(id),   -- NULL = universal/legacy
  plan             subscription_plan NOT NULL,
  source           billing_source,
  amount_minor     INTEGER NOT NULL,                   -- gross charged, pence
  refunded_minor   INTEGER NOT NULL DEFAULT 0,
  currency         CHAR(3) NOT NULL DEFAULT 'GBP',
  period_start     DATE NOT NULL,                      -- coverage window (inclusive)
  period_end       DATE NOT NULL,                      -- coverage window (exclusive)
  status           TEXT NOT NULL DEFAULT 'paid',       -- paid | partially_refunded | refunded
  external_id      TEXT,                               -- stripe invoice id / rc txn id
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: one row per external billing document.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_invoice_external
  ON subscription_invoices (source, external_id) WHERE external_id IS NOT NULL;
-- Fast "invoices overlapping month M for a centre" lookups.
CREATE INDEX IF NOT EXISTS idx_sub_invoice_coverage
  ON subscription_invoices (test_centre_id, period_start, period_end);

COMMIT;
