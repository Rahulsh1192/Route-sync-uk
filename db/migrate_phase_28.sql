-- ============================================================================
-- Phase 28 — email verification and password reset
--
-- `users.email_verified` has existed since the first schema, but nothing in the
-- application could ever set it to true except Google and Apple, which assert it in the
-- identity token. An email/password account therefore had no route to a verified state at
-- all, which matters for more than a badge: `AuthService.upsertOAuthUser` will only link a
-- social identity to an existing account when that account's email is verified, so
-- password sign-ups were permanently on the untrusted side of the anti-takeover rule and
-- would silently get a *second* account when the same person later signed in with Google.
--
-- There was also no password reset, because there was no way to send an email. Both
-- features need the same thing — a single-use, expiring token delivered out of band — so
-- one table serves both.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Token purpose
-- ----------------------------------------------------------------------------
-- An enum rather than free text: these two values are the whole domain, and a typo in a
-- WHERE clause would otherwise silently return no rows — which reads as "expired link"
-- to the user and as nothing at all in the logs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_token_purpose') THEN
    CREATE TYPE email_token_purpose AS ENUM ('verify_email', 'password_reset');
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 2. The tokens
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     email_token_purpose NOT NULL,

  -- SHA-256 hex of the token, never the token itself — the same approach
  -- `refresh_tokens.token_hash` already takes. A dump of this table yields nothing
  -- usable, because a hash cannot be turned back into a working link.
  --
  -- UNIQUE for correctness rather than tidiness: redemption looks a token up by hash
  -- alone, and two rows sharing one hash would make "which account does this link belong
  -- to" ambiguous at exactly the wrong moment.
  token_hash  TEXT NOT NULL UNIQUE,

  -- The address the link was sent to, recorded as it was at the time. A reset is only
  -- valid for the address that received it; if the user changes their email between
  -- request and click, the old inbox must not still be able to take the account.
  sent_to     TEXT NOT NULL,

  expires_at  TIMESTAMPTZ NOT NULL,

  -- Set on redemption. Single use is enforced here rather than by deleting the row: a
  -- deleted token is indistinguishable from one that never existed, and the difference
  -- between "already used" and "never issued" is exactly what you need when a user
  -- reports that a link did not work. (Usually the answer is a mail scanner that
  -- pre-fetched it.)
  used_at     TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Kept for abuse investigation: repeated resets for one account from one address.
  requested_ip INET
);

-- Redemption path: look up by hash, which the UNIQUE constraint already indexes.

-- Invalidation path: when a token is redeemed, every other outstanding token of the same
-- purpose for that user is spent too, so an older email in the inbox stops working.
-- Partial, because a used or expired token is never the target of that update.
CREATE INDEX IF NOT EXISTS idx_email_tokens_user_purpose_live
  ON email_tokens (user_id, purpose)
  WHERE used_at IS NULL;

-- Rate limiting counts recent requests per user; cleanup deletes by age. Both read this.
CREATE INDEX IF NOT EXISTS idx_email_tokens_created_at
  ON email_tokens (created_at);

COMMIT;
