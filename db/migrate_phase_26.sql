-- ============================================================================
-- Phase 26 — contact details on users, and an expiry date on ADI verification
--
-- Two small additions driven by gaps found in the admin console:
--
--  1. `users` had no contact details at all — only an email, which is nullable for
--     OAuth-only accounts. Staff had no way to reach a learner or instructor, and the
--     admin users table had nothing to show.
--  2. `instructor_verifications.adi_number` was already NOT NULL, but nothing recorded
--     when the badge expires. A DVSA ADI certificate is time-limited (4 years), so a
--     verification with no expiry can never be re-checked and a badge that lapsed years
--     ago still reads as "verified".
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Contact details
-- ----------------------------------------------------------------------------
-- All nullable, deliberately. Existing accounts (and every Google/Apple sign-in, which
-- returns no phone number) predate these columns, so a NOT NULL would either need a
-- fabricated default or would lock those users out of an app they already use.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone                   TEXT,
  -- A driving school is commonly expected to hold a second contact for a learner,
  -- especially where the learner is a minor.
  ADD COLUMN IF NOT EXISTS emergency_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

-- Staff search users by phone when someone rings in, which is a substring match against
-- a number that may have been typed with or without spaces or a country code — so the
-- index is on the digits alone. IMMUTABLE-safe: regexp_replace on a column is immutable.
CREATE INDEX IF NOT EXISTS idx_users_phone_digits
  ON users ((regexp_replace(phone, '\D', '', 'g')))
  WHERE phone IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. ADI badge expiry
-- ----------------------------------------------------------------------------
-- Nullable rather than NOT NULL: the rows already in this table were submitted before an
-- expiry was collected, and inventing one would assert something untrue about a real
-- instructor's certificate. New submissions are required to carry it (validated in the
-- API), so this fills in naturally as verifications are resubmitted.
ALTER TABLE instructor_verifications
  ADD COLUMN IF NOT EXISTS adi_expiry DATE;

-- Mirrored onto `contributors` the same way `adi_number` already is, so the badge shown
-- next to an instructor can be checked for currency without joining the verification
-- history.
ALTER TABLE contributors
  ADD COLUMN IF NOT EXISTS adi_expiry DATE;

-- Finds badges that have lapsed or are about to, which is what a "re-verify these
-- instructors" report needs. Partial, because only verified instructors matter here.
CREATE INDEX IF NOT EXISTS idx_contributors_adi_expiry
  ON contributors (adi_expiry)
  WHERE adi_expiry IS NOT NULL AND instructor_status = 'verified';

COMMIT;
