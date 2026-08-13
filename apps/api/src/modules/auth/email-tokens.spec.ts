import {
  createEmailToken,
  hashEmailToken,
  tokenState,
  VERIFY_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
} from './email-tokens';

describe('createEmailToken', () => {
  it('returns a hash that is not the token itself', () => {
    // The whole point of storing a hash: a leaked database must not yield usable
    // reset links, exactly as refresh_tokens.token_hash already does.
    const { token, tokenHash } = createEmailToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toHaveLength(64); // sha256 hex
  });

  it('never issues the same token twice', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => createEmailToken().token));
    expect(tokens.size).toBe(500);
  });

  it('produces a token long enough to resist guessing', () => {
    // 32 bytes of entropy, url-safe base64 => 43 chars.
    expect(createEmailToken().token.length).toBeGreaterThanOrEqual(43);
  });

  it('produces a URL-safe token so it survives being put in a link', () => {
    for (let i = 0; i < 200; i++) {
      expect(createEmailToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('hashEmailToken', () => {
  it('hashes a given token to the same value every time, so lookup works', () => {
    const { token, tokenHash } = createEmailToken();
    expect(hashEmailToken(token)).toBe(tokenHash);
  });

  it('hashes different tokens to different values', () => {
    expect(hashEmailToken('a')).not.toBe(hashEmailToken('b'));
  });
});

describe('tokenState', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it('accepts an unused token that has not expired', () => {
    expect(tokenState({ expiresAt: future, usedAt: null })).toBe('valid');
  });

  it('rejects a token past its expiry', () => {
    expect(tokenState({ expiresAt: past, usedAt: null })).toBe('expired');
  });

  it('rejects a token that has already been redeemed', () => {
    expect(tokenState({ expiresAt: future, usedAt: new Date() })).toBe('used');
  });

  it('reports a redeemed token as used even after it also expired', () => {
    // Order matters for diagnosis: "used" means someone (or something) already followed
    // the link — a mail scanner pre-fetching it, or a replay. "Expired" would hide that.
    expect(tokenState({ expiresAt: past, usedAt: past })).toBe('used');
  });

  it('treats the expiry instant itself as expired', () => {
    const now = new Date();
    expect(tokenState({ expiresAt: now, usedAt: null }, now)).toBe('expired');
  });
});

describe('token lifetimes', () => {
  it('expires a password reset far sooner than an email verification', () => {
    // A reset link is a credential: it grants account access to whoever holds it, so its
    // window is minimised. A verification link grants nothing but a flag, and users
    // routinely open email hours later, so a short one would only create support load.
    expect(RESET_TOKEN_TTL_MS).toBeLessThan(VERIFY_TOKEN_TTL_MS);
    expect(RESET_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
    expect(VERIFY_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
