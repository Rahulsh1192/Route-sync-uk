import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { normalisePhone } from '../../common/validation/phone';
import { AuthProvider, EmailTokenPurpose } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { verifyEmailTemplate, passwordResetTemplate } from '../mail/mail.templates';
import {
  createEmailToken,
  hashEmailToken,
  tokenState,
  VERIFY_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
} from './email-tokens';

/**
 * Per-account cap on verification / reset emails: 5 in a rolling hour.
 *
 * Generous enough that a user who mistypes an address, waits, and tries again is never
 * blocked; tight enough that the endpoint is useless as an inbox flooder.
 */
const EMAIL_RATE_MAX = 5;
const EMAIL_RATE_WINDOW_MS = 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Phase 26 — optional contact details collected at sign-up. */
export interface ContactDetails {
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

interface AppleJwk {
  kty: string;
  kid: string;
  alg: string;
  n: string;
  e: string;
  use?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly google?: OAuth2Client;
  // Apple's public signing keys (JWKS), cached ~1h to avoid a fetch per login.
  private appleKeys: { keys: AppleJwk[]; fetchedAt: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
  ) {
    const googleClientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (googleClientId) this.google = new OAuth2Client(googleClientId);
  }

  async register(
    email: string,
    password: string,
    displayName: string,
    contact?: ContactDetails,
  ): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        identities: { create: { provider: AuthProvider.email, providerUid: email } },
        subscriptions: { create: {} }, // free plan by default
      },
    });

    // Written separately, in raw SQL, because the Phase 26 contact columns are not in the
    // generated Prisma client. Passing them to `user.create` would throw
    // "Unknown argument" — Prisma validates against its own schema, not the database.
    await this.writeContactDetails(user.id, contact);

    // Awaited rather than left floating: `MailService.send` resolves on every failure
    // path instead of throwing, so this can only add the provider's latency, never turn
    // a successful signup into an error. In exchange, a delivery failure is logged
    // against the request that caused it rather than surfacing detached from it.
    await this.sendVerificationEmail(user.id);

    return this.issueTokens(user.id, user.role, user.email ?? undefined);
  }

  /**
   * Store optional contact details for a user.
   *
   * A no-op when nothing was supplied, so OAuth sign-ups (which never carry a phone
   * number) take the same path as email sign-ups without a special case.
   */
  private async writeContactDetails(userId: string, contact?: ContactDetails): Promise<void> {
    if (!contact) return;
    const phone = normalisePhone(contact.phone);
    const name = contact.emergencyContactName?.trim() || null;
    const emergency = normalisePhone(contact.emergencyContactPhone);
    if (!phone && !name && !emergency) return;

    await this.prisma.$executeRaw`
      UPDATE users SET
        phone                   = COALESCE(${phone}, phone),
        emergency_contact_name  = COALESCE(${name}, emergency_contact_name),
        emergency_contact_phone = COALESCE(${emergency}, emergency_contact_phone),
        updated_at              = now()
      WHERE id = ${userId}::uuid`;
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    if (user.isSuspended) throw new UnauthorizedException('Account suspended');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.enforceSingleSessionIfInstructor(user.id, user.role);
    return this.issueTokens(user.id, user.role, user.email ?? undefined);
  }

  /**
   * Phase 17: ADIs are limited to one active session. Revoke all prior refresh
   * tokens so any other device is immediately invalidated. Applied to every login
   * path (password + social) so the rule can't be bypassed via OAuth.
   */
  private async enforceSingleSessionIfInstructor(userId: string, role: string) {
    if (role !== 'instructor') return;
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.log(`Single-session: revoked prior sessions for instructor ${userId}`);
  }

  /** Verify a Google id_token, upsert/link the user, issue our own tokens. */
  async loginWithGoogle(idToken: string, displayName?: string): Promise<TokenPair> {
    if (!this.google) throw new UnauthorizedException('Google login not configured');
    // Accept one or more client IDs (mobile has separate iOS / Android / web IDs).
    const audience = this.clientIds('GOOGLE_CLIENT_ID');
    const ticket = await this.google.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new UnauthorizedException('Invalid Google token');
    return this.upsertOAuthUser(
      AuthProvider.google,
      payload.sub,
      payload.email,
      displayName ?? payload.name,
      payload.email_verified === true,
    );
  }

  /**
   * Sign in with Apple: verify the identity token against Apple's JWKS (RS256),
   * checking issuer, audience (APPLE_CLIENT_ID) and expiry. `displayName` is only
   * sent by the client on the user's FIRST Apple sign-in (Apple omits it after).
   */
  async loginWithApple(identityToken: string, displayName?: string): Promise<TokenPair> {
    if (!this.clientIds('APPLE_CLIENT_ID').length) {
      throw new UnauthorizedException('Apple login not configured');
    }
    const { sub, email, emailVerified } = await this.verifyAppleToken(identityToken);
    return this.upsertOAuthUser(AuthProvider.apple, sub, email, displayName, emailVerified);
  }

  private clientIds(key: string): string[] {
    return (this.config.get<string>(key) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Fetch (and cache ~1h) Apple's public signing keys. */
  private async getAppleKeys(force = false): Promise<AppleJwk[]> {
    const ONE_HOUR = 3_600_000;
    if (!force && this.appleKeys && Date.now() - this.appleKeys.fetchedAt < ONE_HOUR) {
      return this.appleKeys.keys;
    }
    const res = await fetch('https://appleid.apple.com/auth/keys');
    if (!res.ok) throw new UnauthorizedException('Could not fetch Apple public keys');
    const body = (await res.json()) as { keys: AppleJwk[] };
    this.appleKeys = { keys: body.keys, fetchedAt: Date.now() };
    return body.keys;
  }

  /** Cryptographically verify an Apple identity token and return its claims. */
  private async verifyAppleToken(
    identityToken: string,
  ): Promise<{ sub: string; email?: string; emailVerified: boolean }> {
    const parts = identityToken.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed Apple token');
    const [h, p, sig] = parts;
    let header: { alg: string; kid: string };
    let payload: {
      iss?: string;
      aud?: string;
      exp?: number;
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
    };
    try {
      header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid Apple token encoding');
    }
    if (header.alg !== 'RS256') throw new UnauthorizedException('Unexpected Apple token algorithm');

    // Find the signing key by `kid`; refetch once if Apple rotated keys.
    let keys = await this.getAppleKeys();
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      keys = await this.getAppleKeys(true);
      jwk = keys.find((k) => k.kid === header.kid);
    }
    if (!jwk) throw new UnauthorizedException('Apple signing key not found');

    const pubKey = crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' });
    const valid = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`),
      pubKey,
      Buffer.from(sig, 'base64url'),
    );
    if (!valid) throw new UnauthorizedException('Invalid Apple token signature');

    if (payload.iss !== 'https://appleid.apple.com') {
      throw new UnauthorizedException('Bad Apple token issuer');
    }
    if (!payload.aud || !this.clientIds('APPLE_CLIENT_ID').includes(payload.aud)) {
      throw new UnauthorizedException('Apple token audience mismatch');
    }
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException('Apple token expired');
    }
    if (!payload.sub) throw new UnauthorizedException('Apple token missing subject');

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    };
  }

  /**
   * Find or create the user for a verified social identity, then issue tokens.
   * Links to an existing account when the provider asserts the SAME verified
   * email (one account per person), so signing in with email then Google/Apple
   * never creates duplicates. Unverified emails are never auto-linked (prevents
   * account takeover).
   */
  private async upsertOAuthUser(
    provider: AuthProvider,
    providerUid: string,
    email?: string | null,
    name?: string | null,
    emailVerified = false,
  ): Promise<TokenPair> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUid: { provider, providerUid } },
      include: { user: true },
    });
    let user = identity?.user ?? null;

    if (!user && email && emailVerified) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        await this.prisma.authIdentity.create({
          data: { userId: existing.id, provider, providerUid },
        });
        if (!existing.emailVerified) {
          await this.prisma.user.update({ where: { id: existing.id }, data: { emailVerified: true } });
        }
        this.logger.log(`Linked ${provider} identity to existing user ${existing.id} by verified email`);
        user = existing;
      }
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: email ?? undefined,
          emailVerified: !!email && emailVerified,
          displayName: name ?? email?.split('@')[0] ?? 'Test Routify user',
          identities: { create: { provider, providerUid } },
          subscriptions: { create: {} },
        },
      });
    }

    if (user.isSuspended) throw new UnauthorizedException('Account suspended');
    await this.enforceSingleSessionIfInstructor(user.id, user.role);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user.id, user.role, user.email ?? undefined);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const hash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { userId: payload.sub, tokenHash: hash, revokedAt: null },
    });
    if (!stored || stored.expiresAt < new Date()) {
      // Phase 17: distinguish session-invalidated (another device logged in)
      // from a genuinely expired token so clients can show a helpful message.
      const exists = await this.prisma.refreshToken.findFirst({
        where: { userId: payload.sub, tokenHash: hash },
      });
      if (exists?.revokedAt) {
        throw new UnauthorizedException('SESSION_INVALIDATED');
      }
      throw new UnauthorizedException('Refresh token expired or revoked');
    }

    // rotate: revoke the old, issue a new pair
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    return this.issueTokens(user.id, user.role, user.email ?? undefined);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const hash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 28 — email verification and password reset
  // ---------------------------------------------------------------------------

  /**
   * Issue a verification link and email it.
   *
   * Returns quietly when the account has no address or is already verified, so callers
   * (registration, and the "resend" endpoint) don't need to special-case either.
   */
  async sendVerificationEmail(userId: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email || user.emailVerified) return;
    if (await this.tooManyRecentTokens(userId, EmailTokenPurpose.verify_email)) return;

    const url = await this.issueEmailToken(
      user.id,
      user.email,
      EmailTokenPurpose.verify_email,
      VERIFY_TOKEN_TTL_MS,
      'verify-email',
      ip,
    );
    const body = verifyEmailTemplate({ displayName: user.displayName, url });
    await this.mail.send({ to: user.email, ...body });
  }

  /**
   * Redeem a verification link.
   *
   * Marks the address verified, which is what lets a later Google or Apple sign-in with
   * the same address link to this account instead of silently creating a second one.
   */
  async verifyEmail(token: string): Promise<{ verified: true }> {
    const record = await this.redeemEmailToken(token, EmailTokenPurpose.verify_email);
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true },
    });
    this.logger.log(`Email verified for user ${record.userId}`);
    return { verified: true };
  }

  /**
   * Begin a password reset.
   *
   * **Always reports success**, whether or not the address belongs to an account. The
   * response to an unknown address must be indistinguishable from the response to a known
   * one, or this endpoint becomes a way to test whether somebody has an account here —
   * which is worth money to a credential-stuffer and is a privacy leak in its own right
   * (it discloses that a named person uses a driving-instruction service).
   *
   * For the same reason it is silent about a suspended account, an OAuth-only account
   * with no password, and about rate limiting.
   */
  async requestPasswordReset(email: string, ip?: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user?.email && !user.isSuspended && !user.deletedAt) {
      if (!(await this.tooManyRecentTokens(user.id, EmailTokenPurpose.password_reset))) {
        const url = await this.issueEmailToken(
          user.id,
          user.email,
          EmailTokenPurpose.password_reset,
          RESET_TOKEN_TTL_MS,
          'reset-password',
          ip,
        );
        const body = passwordResetTemplate({ displayName: user.displayName, url });
        await this.mail.send({ to: user.email, ...body });
      }
    } else {
      // Logged, not returned. Someone has to be able to answer "why did no email arrive",
      // and the log is the only place that can say so without telling the requester.
      this.logger.log(`Password reset requested for unknown or ineligible address`);
    }

    return { ok: true };
  }

  /**
   * Complete a password reset.
   *
   * Every other session is revoked as part of this. A reset is what someone does when
   * they believe their account is compromised, so leaving an attacker's refresh token
   * alive would defeat the entire exercise.
   */
  async resetPassword(token: string, newPassword: string): Promise<{ reset: true }> {
    const record = await this.redeemEmailToken(token, EmailTokenPurpose.password_reset);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    // The link is bound to the address it was sent to. If the account's email changed
    // between request and click, the old inbox must not still be able to take the account.
    if (user.email !== record.sentTo) {
      throw new UnauthorizedException('This link is no longer valid for this account');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 12),
        // Completing a reset proves control of the inbox — the same thing verification
        // proves — so an unverified account becomes verified here rather than needing a
        // second round trip.
        emailVerified: true,
      },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Password reset completed for user ${user.id}; all sessions revoked`);
    return { reset: true };
  }

  /** Create a token row and return the link to put in the email. */
  private async issueEmailToken(
    userId: string,
    sentTo: string,
    purpose: EmailTokenPurpose,
    ttlMs: number,
    path: string,
    ip?: string,
  ): Promise<string> {
    const { token, tokenHash } = createEmailToken();
    await this.prisma.emailToken.create({
      data: {
        userId,
        purpose,
        tokenHash,
        sentTo,
        expiresAt: new Date(Date.now() + ttlMs),
        requestedIp: ip ?? null,
      },
    });

    const base = this.config.get<string>('APP_BASE_URL');
    return `${base}/${path}?token=${encodeURIComponent(token)}`;
  }

  /**
   * Look a token up by hash, check it, and spend it.
   *
   * Redeeming also spends every other live token of the same purpose for that user, so an
   * older link still sitting in the inbox stops working the moment a newer one is used.
   */
  private async redeemEmailToken(
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<{ userId: string; sentTo: string }> {
    const record = await this.prisma.emailToken.findUnique({
      where: { tokenHash: hashEmailToken(token) },
    });

    // A token for the wrong purpose is treated as no token at all: a verification link
    // must never be redeemable as a password reset.
    if (!record || record.purpose !== purpose) {
      throw new UnauthorizedException('This link is invalid or has expired');
    }

    const state = tokenState(record);
    if (state !== 'valid') {
      this.logger.warn(`Rejected ${purpose} token for user ${record.userId}: ${state}`);
      throw new UnauthorizedException('This link is invalid or has expired');
    }

    const now = new Date();
    await this.prisma.emailToken.updateMany({
      where: { userId: record.userId, purpose, usedAt: null },
      data: { usedAt: now },
    });

    return { userId: record.userId, sentTo: record.sentTo };
  }

  /**
   * Cap how often one account can trigger an email.
   *
   * Without this, an endpoint that takes an address and sends mail is a free way to
   * flood somebody's inbox from our domain — which costs us the sending reputation, not
   * just the quota. The throttler guard limits per IP; this limits per account, which is
   * the thing an attacker rotating IPs is actually targeting.
   */
  private async tooManyRecentTokens(userId: string, purpose: EmailTokenPurpose): Promise<boolean> {
    const since = new Date(Date.now() - EMAIL_RATE_WINDOW_MS);
    const recent = await this.prisma.emailToken.count({
      where: { userId, purpose, createdAt: { gte: since } },
    });
    if (recent >= EMAIL_RATE_MAX) {
      this.logger.warn(`Rate-limited ${purpose} for user ${userId}: ${recent} in the last hour`);
      return true;
    }
    return false;
  }

  private async issueTokens(userId: string, role: string, email?: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role, email },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<number>('JWT_ACCESS_TTL'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<number>('JWT_REFRESH_TTL'),
      },
    );

    const ttl = this.config.get<number>('JWT_REFRESH_TTL')!;
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
