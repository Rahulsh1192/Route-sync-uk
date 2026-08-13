import * as crypto from 'crypto';

/**
 * Single-use tokens for email verification and password reset.
 *
 * Kept as free functions with no dependencies so the security-critical parts — how much
 * entropy a token carries, and the exact conditions under which one is accepted — can be
 * tested directly, without a database or a mail transport standing in the way.
 *
 * The storage model mirrors `refresh_tokens`: the token goes in the email, only its
 * SHA-256 goes in the database. A dump of `email_tokens` therefore yields nothing usable,
 * because the column cannot be turned back into a link.
 */

/**
 * How long a verification link stays good.
 *
 * A day, because the link grants nothing on its own — it sets a flag confirming the
 * address is reachable. People open email the next morning, and a link that died
 * overnight produces support requests without preventing anything.
 */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a reset link stays good.
 *
 * An hour. Unlike verification, this link *is* a credential: whoever holds it can take
 * the account. Long enough to walk away from the laptop and come back, short enough that
 * a link sitting in a mailbox backup is not a standing key to the account.
 */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface EmailTokenRecord {
  expiresAt: Date;
  usedAt: Date | null;
}

export type TokenState = 'valid' | 'expired' | 'used';

/**
 * Mint a token and the hash to store against it.
 *
 * 32 bytes from the CSPRNG, base64url-encoded. Base64url rather than hex because the
 * token travels in a URL: the encoding has no characters a mail client, a link-shortener
 * or a query parser will alter, so what the user clicks is what was issued.
 */
export function createEmailToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashEmailToken(token) };
}

/** SHA-256 of a token, hex — the form stored in `email_tokens.token_hash`. */
export function hashEmailToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Decide whether a stored token may still be redeemed.
 *
 * `used` is reported ahead of `expired` when both apply. The two are equivalent to the
 * person clicking — both mean "ask for a new link" — but they are not equivalent in the
 * logs: `used` means something already followed this link, which is either a replay or,
 * far more often, a corporate mail scanner pre-fetching URLs. Collapsing it into
 * `expired` would hide the one signal that explains why a user swears they never clicked.
 */
export function tokenState(rec: EmailTokenRecord, now: Date = new Date()): TokenState {
  if (rec.usedAt) return 'used';
  // `<=` rather than `<`: at the exact expiry instant the token is spent, not still live.
  if (rec.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}
