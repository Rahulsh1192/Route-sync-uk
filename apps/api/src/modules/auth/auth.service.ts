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
import { AuthProvider } from '@prisma/client';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
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
  ) {
    const googleClientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (googleClientId) this.google = new OAuth2Client(googleClientId);
  }

  async register(email: string, password: string, displayName: string): Promise<TokenPair> {
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
    return this.issueTokens(user.id, user.role, user.email ?? undefined);
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
