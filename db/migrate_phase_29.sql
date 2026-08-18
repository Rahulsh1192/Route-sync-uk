-- ============================================================================
-- Phase 29 — grandfather existing accounts before the verification gate
--
-- Signing in now requires `users.email_verified` (see AuthService.login). Until Phase 28
-- nothing in the application could set that flag for an email/password account, so every
-- account created before it — including the seeded demo logins — sits at false. Deploying
-- the gate without this backfill would lock out every existing user, which is a far worse
-- outcome than trusting addresses that were already in use.
--
-- Run this BEFORE deploying the API that carries the gate. Early is harmless; late is an
-- outage. It must be run against every database that serves traffic, which includes
-- Supabase, not only local Postgres.
--
-- Deliberately unconditional on date: "created before the gate existed" is exactly the set
-- of rows present when this runs, and a timestamp cutover would need a value that is only
-- knowable at deploy time.
--
-- Idempotent: the WHERE clause makes a second run a no-op.
-- ============================================================================

BEGIN;

UPDATE users
   SET email_verified = true,
       updated_at     = now()
 WHERE email_verified = false;

COMMIT;

-- Confirm afterwards — expect a single row, `t`:
--   SELECT email_verified, count(*) FROM users WHERE deleted_at IS NULL GROUP BY 1;
